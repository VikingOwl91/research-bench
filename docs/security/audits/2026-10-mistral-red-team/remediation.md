# Remediation backlog — 2026-10 Mistral red-team audit

Baseline: `4fd379dbfd2d0b25881bc219f18c0d66178ad8b3` (v0.0.4).
Remediation branch: `fix/red-team-v004`. The original audit reports
([findings.md](findings.md), [coverage.md](coverage.md), [README.md](README.md))
are preserved unchanged as historical evidence.

Statuses: **MITIGATED (verified)** — the fix is implemented and demonstrated;
residual risk is documented. **PARTIALLY MITIGATED** — the main vectors are
closed, a bounded residual remains. **OPEN** — not implemented.

No finding is marked RESOLVED without demonstrated verification. Residual
risks are stated per finding and are not silently closed.

## Verification summary (re-test of HEAD `5ce5a47` and successors)

| Gate | Result |
|---|---|
| `pnpm check` (svelte-check) | 0 errors, 0 warnings |
| `pnpm test` (unit) | 350/350 passed (326 baseline + 24 new: 21 gate, 2 watchdog, 1 controller) |
| `cargo test` (research-core) | 9/9 passed (6 baseline + 3 hidden-span/canonicalization) |
| `pnpm test:security` | Chromium 16/16 (incl. 2 new support-gate specs). Firefox 12/16 — 4 intermittent model-load/storage flakes under suite context churn, all of the RB-RT-007 residual class (present at baseline; one new gate spec is subject to the same flakiness) |
| `pnpm test:e2e` | Chromium 36/36 (incl. 2 new source-viewer specs). Firefox: 59 passed / 8 failed / 5 skipped overall — the 5 playback tests skip without an audio backend (verified: 5 skipped; CI provides pulseaudio and runs them); the 8 failures are the rotating RB-RT-007 environment flakes (IndexedDB errors and slow model loads under suite context churn; the failing set rotates between runs — e.g. researchbench:93 passed this run and failed the previous one — and every flake is also present at the audit baseline) |
| Live-provider re-test (authorized, budget-capped) | 6 original attack scenarios, 23 provider calls: **0 fabricated-value leaks** in displayed, persisted, or spoken output; injection neutralized in 4/4 chat requests; 2 fabricated podcast turns quarantined before TTS; 0 unexpected egress; 0 console/page errors |
| RB-RT-006 proof | a 500,000-character source indexes to completion in 428 s (625 chunks), no watchdog kill |

Fix commits: `78fc81d` (RB-RT-001..004), `01b5449` (RB-RT-005, RB-RT-008),
`99fad30` (RB-RT-006, RB-RT-009), `38c441a` (RB-RT-007), `5ce5a47` (review
follow-up). Re-test commit: HEAD of `fix/red-team-v004` at the time of the
runs above.

---

## RB-RT-001..004 — Unsupported claims presented as source-supported (chat, Studio, podcast, history)

- **Root cause:** the application validated citation *identity* but never
  claim *support*; the only barrier was the system prompt, which indirect
  document instructions defeated on the default provider.
- **Implemented mitigation** (`78fc81d`, `5ce5a47`): two deterministic,
  local, model-free layers shared by Chat, Summary, FAQ, Study Guide and
  Podcast.
  1. `sanitizeForModel` neutralizes instruction-like sentences in untrusted
     documents before they enter the provider prompt (EN/DE/FR patterns,
     sentence-level so benign content is preserved).
  2. `applySupportGate` / `applyPodcastSupportGate` check every answer block
     and podcast turn — cited against its cited excerpts, uncited against the
     full excerpt pool — against the exact sanitized text the model saw.
     Blocks/turns whose checkable specifics (quoted spans, significant
     numbers) are absent are quarantined: the claim is replaced by a
     deterministic removal notice and loses its citations, before display,
     persistence, or speech synthesis. Heading and text are gated
     independently; number formatting never decides support.
- **Fix commit SHA:** `78fc81d` (+ `5ce5a47` follow-up).
- **Re-test commit SHA:** HEAD of `fix/red-team-v004`.
- **Re-test result:** deterministic unit tests (21) and browser specs (chat,
  FAQ, podcast, persistence, TTS-body assertions) pass; live re-test of the
  original scenarios shows 0 fabricated-value leaks; the model answered
  honestly in chat/FAQ once the instruction was neutralized, and the gate
  quarantined the 2 fabricated podcast turns the model still produced.
- **Residual risk:** (a) prose without checkable specifics (the audit's A10b
  elaboration case) and fabricated proper nouns still pass — presence of a
  specific is necessary, not sufficient, evidence; (b) single-digit numbers
  are not enforced (counting phrases would false-positive); (c) the
  sanitizer is EN/DE/FR sentence heuristics — obfuscated, encoded, or
  other-language injection phrasings reach the model, and are caught only if
  the resulting claim carries checkable specifics; (d) the answer *title* is
  not gated. Model-assisted entailment verification was considered and
  rejected for the gate: asking the same model whether its own answer is
  correct is circular, and a second model adds cost, latency, and its own
  error modes without a deterministic guarantee.
- **Independent reviewer verdict:** PARTIALLY MITIGATED — real control at the
  right chokepoints, verified; the reviewer found and we closed the
  uncited-block bypass, the whole-block-replacement false positive, and the
  thousand-separator mismatch; the residuals above are accepted and
  documented.

## RB-RT-005 — Hidden PDF text invisible in the original rendering

- **Root cause:** Pdfium extracts invisible (render mode 3) and near-white
  text without any provenance signal; the app indexed, cited, and displayed
  it as ordinary text.
- **Implemented mitigation** (`01b5449`): per-character visibility from
  render mode and fill color is captured during parsing; hidden spans are
  carried through canonicalization in UTF-16 coordinates
  (`canonicalize_with_visibility`) and marked with a dotted underline plus a
  legend in the source viewer. Extraction itself is unchanged: flags are
  only used when the aligned character sequence matches the extracted text
  exactly, and characters outside the page bounds are excluded to mirror
  the bounded extraction.
- **Fix commit SHA:** `01b5449`.
- **Re-test commit SHA:** HEAD of `fix/red-team-v004`.
- **Re-test result:** Rust unit tests (3) and e2e specs (hidden text indexed,
  searchable, marked; legend; textless-page notice) pass on both browsers;
  extraction of the existing fixtures is byte-identical.
- **Residual risk:** pages whose bounded extraction diverges from the
  character stream are conservatively left unmarked; light gray below the
  near-white threshold and text hidden behind drawn overlays are not
  detected. Hidden text remains indexed by design (OCR layers depend on it).
- **Independent reviewer verdict:** PARTIALLY MITIGATED — disclosure
  compensating control verified; the listed detection gaps are accepted.

## RB-RT-006 — Advertised 500,000-character limit unachievable (watchdog)

- **Root cause:** the five-minute pipeline watchdog killed long-but-
  progressing indexing jobs before the documented limit was reachable.
- **Implemented mitigation** (`99fad30`): the watchdog now resets whenever
  the worker reports progress, so it bounds wedged jobs instead of total
  work. Total work remains bounded by the unchanged limits (10 MiB, 2,000
  pages, 500,000 characters, 1,000 chunks). No public limit or documented
  guarantee was changed.
- **Fix commit SHA:** `99fad30`.
- **Re-test commit SHA:** HEAD of `fix/red-team-v004`.
- **Re-test result:** a 500,000-character source indexes to completion in
  428 s (625 chunks) with no watchdog kill; unit tests prove the watchdog
  still kills a wedged worker and spares a progressing one.
- **Residual risk:** on very slow devices, indexing near the limit can take
  many minutes; the UI shows progress but no ETA.
- **Independent reviewer verdict:** MITIGATED — verified end-to-end.

## RB-RT-007 — Firefox-specific test and model-cache failures

- **Root cause (diagnosed with evidence):** (1) Firefox default profiles
  reject the 118-MB model's CacheStorage entry (per-entry quota), which
  failed the whole model load on transformers.js's streaming cache path and
  surfaced to users as a spurious "storage is full" error; (2) native media
  playback needs an audio backend that CI provides via pulseaudio but bare
  environments lack; (3) intermittent IndexedDB errors under Playwright
  context churn in this environment (present at baseline).
- **Implemented mitigation** (`38c441a`): the pipeline worker retries the
  model load once with the Cache API disabled when the load fails with
  QuotaExceededError (the model then loads via the immutable HTTP cache or a
  direct fetch; retention stays best-effort as documented in
  docs/verification.md); cache-retention assertions are browser-aware with
  comments citing the documented contract; playback-dependent e2e tests
  skip with a documented reason when no audio backend is running (CI provides
  one and runs them).
- **Fix commit SHA:** `38c441a`.
- **Re-test commit SHA:** HEAD of `fix/red-team-v004`.
- **Re-test result:** the deterministic Firefox quota failure on first
  import is gone (verified: repeated uploads succeed where they failed
  deterministically before); the deterministic retention-assertion failures
  are fixed; the 5 playback tests skip without a backend (verified: 5
  skipped) and run in CI; Chromium is unchanged and fully green.
- **Residual risk:** in THIS environment, a rotating set of ~8 Firefox e2e
  tests and ~4 Firefox security tests fails intermittently (IndexedDB
  NotReadableError / UnknownError and slow model loads under suite context
  churn; the failing set rotates between runs and includes occasionally one
  of the new specs). Every flake is also present at the audit baseline,
  fails at timeouts rather than assertions, and is environment-specific (no
  pulseaudio here; Firefox storage under recycled Playwright contexts). It
  is not concealed: the baseline and re-test results are recorded in the
  audit coverage report and here. CI parity on a runner with pulseaudio
  should be confirmed before merge.
- **Independent reviewer verdict:** PARTIALLY MITIGATED — the user-facing
  quota bug and the deterministic test failures are fixed and verified; the
  environment-specific flakes are documented as residual with a CI-parity
  follow-up.

## RB-RT-008 — Extraction-fidelity and limit-accounting discrepancies

- **Root cause:** limits and model context apply to *extracted* text, and
  extraction silently depends on Pdfium's choices (page-bounds filtering,
  graphic-only pages, diagram text), which the UI did not disclose.
- **Implemented mitigation** (`01b5449`): the source viewer reports pages
  without extractable text for PDFs (extraction coverage), and the README
  now documents that character limits count extracted text within the page
  bounds. No limit was changed.
- **Fix commit SHA:** `01b5449`.
- **Re-test commit SHA:** HEAD of `fix/red-team-v004`.
- **Re-test result:** e2e spec verifies the coverage notice (mixed-pages
  fixture) on both browsers; README wording verified.
- **Residual risk:** extraction fidelity itself is unchanged (diagram text
  still omitted, documented in docs/verification.md); a PDF whose extracted
  text is far smaller than its visible content shows the coverage notice but
  no per-page detail beyond textless pages.
- **Independent reviewer verdict:** MITIGATED (disclosure and coverage
  reporting verified; extraction behavior itself is a documented
  limitation).

## RB-RT-009 — Silent staleness aborts

- **Root cause:** discarding an in-flight job because the sources or
  settings changed cleared the progress indicator without any explanation.
- **Implemented mitigation** (`99fad30`): a localized notice
  (`runtime.staleAbort`) is published when a state change discards an
  in-flight job (source deletion, notebook create/switch, provider switch,
  key change) and when the revision guard detects a cross-tab change. An
  explicit user cancel stays silent.
- **Fix commit SHA:** `99fad30`.
- **Re-test commit SHA:** HEAD of `fix/red-team-v004`.
- **Re-test result:** unit tests cover the notice for each mutator, the
  cross-tab revision path, and the silent explicit-cancel path; the updated
  existing tests assert the notice where it belongs.
- **Residual risk:** deleting a podcast artifact or wiping all data still
  discards in-flight work silently (the state itself is gone); a job that
  completes between the state change and the cancellation can show a
  notice for an answer that was actually saved (harmless over-reporting).
- **Independent reviewer verdict:** MITIGATED — verified; residuals
  documented.

## Cross-cutting notes

1. Deterministic CI coverage: unit tests (gate, sanitizer, watchdog,
   controller), security specs (quarantine in chat/Studio/podcast,
   persistence, TTS bodies, sanitizer assertions), e2e specs (source viewer,
   extraction coverage). Live-provider evaluation is a separate,
   budget-capped artifact (credentials redacted; synthetic fixtures only) —
   probabilistic model behavior is recorded as evaluation, not asserted as a
   brittle binary CI gate.
2. Raw evidence (fixtures, harnesses, captured traffic, suite logs) is
   retained in a local audit workspace outside the repository, sanitized of
   credentials.
3. Security boundaries that must remain intact were re-verified: CSP,
   key confinement, egress allow-list, schema validation, storage guards —
   all covered by the unchanged passing suites.
4. Follow-up before merge: confirm CI parity on a runner with pulseaudio
   (RB-RT-007 residual), and consider the documented residuals above for the
   v0.1.0 semantic-verification milestone.
