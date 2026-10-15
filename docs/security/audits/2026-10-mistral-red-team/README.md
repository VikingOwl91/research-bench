# 2026-10 Mistral red-team audit — ResearchBench v0.0.4

Independent adversarial security and robustness audit of ResearchBench
v0.0.4, conducted ahead of the planned v0.1.0 milestone.

- [findings.md](findings.md) — confirmed findings with evidence
- [coverage.md](coverage.md) — attack coverage matrix and test accounting
- [remediation.md](remediation.md) — prioritized remediation backlog

## Executive summary

ResearchBench's browser security posture is strong: the Content Security
Policy is strict and hash-bound, there are no HTML-injection sinks, API keys
are confined to session storage and provider authorization headers, all
observed network egress goes only to the two configured provider origins, and
the ingestion, decoding, and storage layers survived adversarial fuzzing and
malformed-input probes without crashes, unbounded allocation, or partial
saves. The existing test suites (326 unit tests, 6 Rust tests, Playwright
e2e and security suites) were run as the audit baseline.

The audit's principal result is on the generation side. The application
validates the *identity* of citations but has no check that a generated
claim is *supported* by the cited excerpt — a limitation the project already
documents (`docs/verification.md`, "Semantic grounding remains FAIL"). What
this audit adds is live, injection-driven evidence that the gap is trivially
reachable: a short, politely phrased instruction embedded in an uploaded
document made the default provider (Mistral direct, `mistral-small-2603`)
repeat a fabricated safety claim ("99 mg/L is completely safe") **with a
valid citation to the attacker-controlled document** — in chat answers, in
Studio FAQ and Study Guide artifacts, and once in a synthesized podcast
transcript. Direct "SYSTEM OVERRIDE"-style injections, multilingual and
encoded injections, and key-exfiltration attempts were resisted, so the
instruction hierarchy holds against obvious attacks and fails against
indirect ones. Success is probabilistic (sampling-dependent), not
deterministic; one OpenRouter run of the same payload was also resisted.

Secondary findings cover PDF extraction fidelity (invisible and white text
is indexed although it is invisible in the user's PDF reader; extraction
silently drops stacked text runs, which also relaxes the advertised size
limit), an unachievable 500,000-character indexing limit (the five-minute
watchdog fires first), Firefox-specific baseline test failures around the
118 MB model cache, and silent staleness aborts with no user feedback.

No critical finding was confirmed: there is no demonstrated path to
confidentiality compromise, credential disclosure, or code execution.

## Audit provenance

| Field | Value |
|---|---|
| Repository | `research-bench` (local checkout) |
| Baseline commit | `4fd379dbfd2d0b25881bc219f18c0d66178ad8b3` |
| Version / tag | `0.0.4` (package.json); build identity `0.0.4+4fd379dbfd2d0b25881bc219f18c0d66178ad8b3`; no tag on this commit |
| Repository state at audit start | Clean working tree (`git status --porcelain` empty); the production `build/` output matched the HEAD commit identity |
| Audit dates | 2026-10-15 (single day; start to completion) |
| Auditor | Independent adversarial reviewer role |
| Auditor model | Mistral Large 4 (`mistral-large-4`, provider `mistral`) |
| Tested application configuration | Production static build of the baseline commit, served on loopback with the repository's own `scripts/serve-build.mjs` hosting contract (security headers, CSP, cache policy) |
| Runtime versions | Node.js 26.11.1, pnpm 11.28.5, Rust 1.98.1 (repo-pinned toolchain) |
| Key dependencies | Svelte 5.57.2, SvelteKit 3.0.1, zod 4.6.5, @huggingface/transformers 4.3.1, idb 8.0.4, @breezystack/lamejs 1.2.7, pdfium-render 0.9.4 (pinned assets: multilingual-e5-small embedding model, pdfium wasm, ONNX runtime) |
| Browsers | Chromium and Firefox (Playwright 1.64.0) for baseline suites; Chromium for all live-provider scenarios |
| Mocks vs. real providers | Baseline suites use mocked providers. The audit's live campaign used **real providers** under explicit authorization with dedicated local credentials: Mistral direct (`mistral-small-2603`, EU endpoint) and OpenRouter (`mistralai/mistral-small-2603`), plus real TTS (`voxtral-mini-tts-2603`). Ingestion, decoding, and workflow probes ran fully locally |
| Repository changes during audit | None. The repository was not modified; all fixtures, harnesses, and evidence were kept in a separate local audit workspace outside the repository |

Revision attribution: every piece of evidence in this audit was produced
against the baseline commit above. No evidence is attributed to any other
revision.

## Architecture and trust boundaries

ResearchBench is a static, local-first browser application:

- **Main thread**: Svelte UI, `ResearchBenchController` (job/revision/config
  guards), `BenchStorage` (IndexedDB), provider clients (fetch to the two
  configured endpoints), and the podcast audio engine host.
- **Pipeline worker**: Rust/WASM core (`parse_text`, `parse_pdf`,
  `chunk_pages`, `cosine_search`), Pdfium WASM for PDF text extraction, and
  the local multilingual E5 embedding model via ONNX (transformers.js).
  Worker CSP allows same-origin scripts and WASM execution only.
- **Encoder worker**: lamejs MP3 encoding for podcast episodes.
- **Local persistence**: IndexedDB (notebooks, sources and original blobs,
  chunks and embeddings, messages, artifacts, audio), sessionStorage (API
  keys, provider selection), localStorage (active notebook, theme, locale),
  CacheStorage (model cache).
- **External services**: Mistral EU API and OpenRouter (chat completions,
  speech synthesis, voice/model discovery). These are the only network
  egress points.

Trust boundaries the audit attacked:

1. **Uploaded documents → local index → model prompt.** Document text is
   untrusted data. It is chunked, embedded, retrieved, and placed into the
   model's user message verbatim. The system prompt declares it untrusted;
   nothing else separates it from instructions.
2. **Model output → UI.** Model responses are untrusted. They are
   schema-validated (zod + strict JSON-schema wire format), size-bounded,
   citation-ID-checked against the transmitted context, and rendered as
   escaped text (no HTML sinks). Citation IDs prove *membership*, not
   *support*.
3. **Provider responses → application.** Bounded reads, status-mapped safe
   errors, no retries or fallback, no raw provider bodies surfaced.
4. **API key → provider.** The key lives in sessionStorage, travels only in
   the Authorization header to the two hardcoded endpoints, and never
   appears in prompts, IndexedDB, localStorage, the build, or logs.
5. **Cross-tab / concurrent state.** Web Locks for podcast rendering,
   notebook revision checks, and a data epoch for wipe fencing.

## Methodology

1. **Baseline**: ran the repository's own gates against the baseline commit —
   `pnpm test` (326 unit tests), `cargo test` (6 Rust tests), `pnpm
   test:security` (Playwright security suite, Chromium + Firefox), `pnpm
   test:e2e` (Playwright e2e suite, Chromium + Firefox).
2. **Static review** of the application, worker, storage, provider, audio,
   i18n, build, and hosting-policy code; trust-boundary mapping.
3. **Deterministic adversarial probes** without providers:
   - 34 native Rust probes against the research-core crate (limits, UTF-16
     offset semantics, cosine edge cases) via a scratch crate depending on
     the repo crate by path;
   - 59 pure-function probes (vitest) against the WAV/PCM/MP3 decoders
     (40,000 fuzz inputs), output validators, context builder, and display
     helpers;
   - 4 ingestion probe rounds against the real production build (malformed,
     truncated, oversized, wrong-extension, Unicode, hidden-text,
     malicious-PDF-feature, extreme-filename, and boundary documents).
4. **Live-provider campaign** (authorized, budget-capped): drove the real
   production build in Chromium through the actual UI with the dedicated
   Mistral and OpenRouter credentials — 43 unique attack scenarios across
   chat, all Studio generators, podcast (script + TTS), and workflow
   integrity, with full request/response capture, redaction, and egress
   monitoring.
5. **Independent review**: a separate reviewer agent challenged the findings
   register and severity assignments; its challenges and their resolutions
   are recorded in [findings.md](findings.md).

All fixtures are synthetic and fictional. No real user data, production
systems, or third-party infrastructure were involved. Provider spending was
bounded to a small number of low-cost calls (see [coverage.md](coverage.md)).

## Baseline gate results: what passed, what failed, and why

The verification gates did **not** all pass. This is stated plainly so the
baseline cannot be misread as a clean sweep.

**Fully passed:**

- `pnpm check` (Svelte/TypeScript diagnostics): 0 errors, 0 warnings.
- `pnpm test` (unit): 326/326 passed.
- `cargo test` (research-core): 6/6 passed.
- The pre-existing production `build/` was verified to match the HEAD commit
  identity (`0.0.4+4fd379d…`). A fresh `pnpm build` was not re-run; the
  audited artifact is that verified build.

**Failed (not concealed; see RB-RT-007):**

- `pnpm test:security`: 25/28 passed — 3 failures, all Firefox
  (strict-CSP runtime test, both variants, plus one flaky 118-MB cache test).
- `pnpm test:e2e`: 58/68 passed — Chromium 34/34; Firefox 24/34 with 10
  failures (nine at the 3-minute test timeout around the 118 MB model
  download/cache and audio playback, one fast CacheStorage double-read
  assertion).

**Classification of those failures:** all 13 are Firefox-only and cluster on
the 118 MB model asset's cache/download timing and audio-playback clocks in
this environment. They are **environment-specific failures** (browser cache
and timing behavior), not product security defects, and not audit-harness
failures. No product failure was observed in the baseline suites; the
product issues in this audit (RB-RT-005, RB-RT-006, RB-RT-009) were found by
the audit's own probes, not by the baseline suites. `docs/verification.md`
already disclaims guaranteed model-cache retention per browser profile.

**Successful audit harness checks** (the audit's own instrumentation, all
passing): zero unexpected network egress across all 43 scenarios; zero
unexpected console/page errors (only expected provider 429 resource
messages); credential redaction verified by inclusion scan of all evidence;
storage/integrity assertions in the workflow probes; and sanitization of this
documentation itself (credential inclusion scan before commit — no keys, no
absolute paths, no personal data in these files).

## Overall assessment

**Finding counts** (see [findings.md](findings.md) for detail):

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| High | 3 | CONFIRMED / PARTIALLY REPRODUCED |
| Medium | 2 | CONFIRMED |
| Low | 3 | CONFIRMED |
| Informational | 1 | CONFIRMED |

**By category:**

- Newly demonstrated instances of a documented limitation (injection-driven
  citation-integrity failures): RB-RT-001, RB-RT-002, RB-RT-003, RB-RT-004.
- Newly discovered defects (extraction fidelity, unachievable limit, silent
  aborts): RB-RT-005, RB-RT-006, RB-RT-009.
- Environment/test-infrastructure observations: RB-RT-007, RB-RT-008.
- Security vulnerabilities with confidentiality/code-execution impact: **none
  confirmed.**
- Model-level behavioral failures (as opposed to application-level
  failures): the injection successes are model behavior; the application
  failures are the missing support check, the missing extraction
  provenance, and the missing user feedback.

**Readiness for v0.1.0:** the browser-security, key-handling, ingestion,
decoding, and state-integrity surfaces are in good shape and well covered by
existing tests. The generation-integrity surface is not: the documented
semantic-grounding gap is live and demonstrably reachable by a one-paragraph
instruction in an uploaded document, on the default provider, across chat
and Studio. This does not require a redesign — the project already names the
fix direction (support checking) — but v0.1.0 should either implement a
support/entailment check or ship with the current UI copy hardened so that
citations are never presented as verification, plus a documented injection
resistance test. See [remediation.md](remediation.md) for the prioritized
backlog.

## Known limitations of this audit

- Live-provider testing ran in Chromium only; Firefox was covered by the
  baseline suites and local probes, not by live generation.
- Several OpenRouter comparison scenarios were blocked by provider rate
  limits (429) during the audit window; the provider comparison is therefore
  partial (see [coverage.md](coverage.md)).
- Injection outcomes are sampling-dependent; reproduction counts are stated
  per finding rather than implied to be deterministic.
- The project's nine private negative grounding fixtures are not in the
  repository; this audit constructed its own equivalents (and confirmed the
  documented failure class reproduces live).
- The independent review's coverage was partial: the reviewer hit its
  execution step limit after reading roughly 20 of the 48 evidence files and
  did not read the campaign or baseline logs; every item it flagged was
  re-verified directly against the evidence by the audit author (see
  [findings.md](findings.md), "Independent finding-validation summary").
- Raw evidence artifacts (captured requests/responses, probe outputs) are
  retained in a local audit workspace outside the repository, sanitized of
  credentials; they are not committed.
