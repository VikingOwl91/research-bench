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

## Review round 2 — 2026-10-15

Starting point: `a512125510094438b9015e1929743d9d642efb95`, branch
`fix/red-team-v004`. The independent pre-merge verdict was **DO NOT MERGE**.
All nine findings were independently reproduced on that unchanged candidate
before production changes. The original audit README, findings and coverage
remain unchanged. This section supersedes the Round 1 implementation claims;
it does not rewrite the historical observations below.

### Corrections and permanent regressions

| Review finding | Correction | Permanent regression |
|---|---|---|
| R1: 1,000-fold numeric equivalence and formatting errors | Validated whole numeric tokens and exact canonical decimal keys replace punctuation stripping and floating-point tolerance. | Both answer/podcast gate controls in `tests/unit/support-gate.test.ts`: mixed grouping, ambiguous literals, precision, signs, malformed tokens. |
| R2: parentheses, fullwidth digits, visible angle brackets and ASCII quotes bypass matching | NFKC-normalized displayed/spoken text is checked without stripping angle-bracket content. Parentheses no longer suppress numbers; paired ASCII/typographic quotes are recognized. | Unit negatives plus `tests/security/remediation-round2.spec.ts`: both providers, Chat, Summary, FAQ, Study Guide, podcast TTS, saved transcript/answers, reload and next-turn history. |
| R3: ordinary possessives remove supported prose | Word apostrophes are separated from paired quotation delimiters; supported controls accompany rejection cases. | Both-gate supported paraphrases, possessives, contractions, plural possessives, adjacent quotations, numerical formatting and headings. Independent review required one further quoted-word/outside-possessive correction. |
| R4: resumed persisted scripts bypass the current gate | `claimPodcastResume` validates frozen evidence/citation membership and applies the same gate inside its existing fenced transaction, before mutation or new speech. Unsafe or missing-evidence drafts are rejected with a localized regeneration message. | Controller/storage tests preserve cached audio and the paused draft byte-for-byte, including an unsupported already-cached turn. Browser tests for both providers assert zero generation/TTS calls and unchanged stored script/audio after rejected resume/reload. Existing supported resume tests still require missing-segment-only synthesis. |
| R5: functioning Firefox audio is falsely skipped | Probe awaits bounded initialization/resume and an advancing audio clock. Required playback coverage fails explicitly if unavailable; it never silently skips. | `tests/e2e/audio-backend.spec.ts`: real Chromium/Firefox readiness, delayed initialization, unavailable bounded/closed context. Full E2E must execute the five previously skipped Firefox workflows. |
| R6: Firefox test requires a cache miss | Warm retrieval remains required; the default-profile check accepts one retained download or one re-download, rejecting unbounded requests. The dedicated explicit-budget retention test stays strict. | Existing `researchbench.spec.ts` reload/retrieval test and unchanged strict retention security test. |
| R7: quadratic viewer segmentation stalls the main thread | Sorted interval merge/monotonic sweep; provenance decoration is capped at 1,000 incoming spans. Above the cap, all canonical text and citation highlighting remain, with an explicit EN/DE marker-omission notice. | Pure segmentation tests and actual-WASM valid-PDF browser benchmarks at 5,000/50,000 spans, exact text/citation retention and bounded DOM in both browsers. |
| R8: invisible clipping/transparent paint is unmarked | Classify active fill/stroke channels for modes 0–7, including non-painting mode 7 and zero alpha; unused fill no longer hides visible outlines. | Native paint-channel controls and 13-page actual-Pdfium fixture with mode/alpha combinations in Chromium/Firefox. |
| R9: definitive invisibility wording mislabels visible text | EN/DE UI describes rendering properties; near-white paint/background uncertainty is explicit. | Viewer provenance/locale browser tests, including visible outlines and white-on-black. |

### Numeric interpretation and deliberate tradeoff

No trustworthy source numeric-locale metadata exists. A lone separator with
exactly three trailing digits (`1.234` or `1,234`) is ambiguous and therefore
matches only the **same normalized literal**. It does not match `1234`, the
other separator, or `1.2340`. The review's proposed decimal-positive example
`1.234` → `1.2340` assumes a decimal locale: in a German grouping context the
same conversion changes the mathematical value by 1,000. This conservative
false positive is accepted explicitly rather than silently guessing a locale.

Unambiguous mixed forms such as `1,234.50` / `1.234,50` / `1234.50` and repeated
valid thousands groups normalize to exact keys. Signs are retained; no relative
floating-point tolerance silently accepts a nearby value. Malformed tokens
cannot match a supported numeric prefix. Line-leading list markers are a
narrow syntax exemption. This is lexical presence checking, not arithmetic,
unit conversion, locale inference or claim entailment.

### Remaining limitations and scope

- Existing-number false conclusions, invented proper names, unsupported prose,
  single-significant-digit values and ungated titles remain possible. Matching
  a value/quotation does not establish attribution or semantic support.
- Numeric ambiguity can quarantine correct reformattings. Negations,
  spelled-out values and unit conversions can also produce heuristic false
  positives. Ambiguous single-quote/plural-apostrophe punctuation can cause both
  false positives and false negatives: the lexer can end a quotation early and
  leave an unsupported remainder as unchecked prose. For example, source
  `The labs have measurements.` and output `The source says ‘The labs’ report
  certifies all waters’ during inspection.` can match only `The labs`. This
  residual is accepted explicitly; the lexer is not a grammar or semantic
  verifier. The UI discloses both surviving unsupported claims and removed
  supported wording.
- The source sanitizer remains sentence-level EN/DE/FR heuristics. Obfuscation,
  uncovered languages/phrasing and cross-turn propagation of accepted prose
  remain possible. Legitimate security material describing an injection can
  lose a matched sentence. No universal injection resistance is claimed.
- Unsafe persisted drafts are rejected, not rewritten against old audio.
  Historical ready artifacts are not retrospectively certified or modified.
  Rejected paused drafts/segments remain available until explicitly replaced
  or deleted; their existing transcript is historical output.
- PDF provenance is partial: unknown paint data, character-alignment fallback,
  backgrounds, clipping effects, overlays and blend modes prevent complete
  rendering-visibility inference. Above the decoration budget, individual
  markers are omitted explicitly while all extracted/cited text remains.
- The worker watchdog is an inactivity deadline, not a total CPU-time budget.
  Historical intermittent Firefox IndexedDB failures remain unexplained;
  baseline occurrence alone does not prove an environmental cause. The new
  quota retry's escaping-error branch is not proven by a swallowed Cache.put
  failure in the dependency. No unrelated watchdog/cache redesign was added.
- No semantic judge, answer-generation schema change, extraction-only mode,
  new dependency, release tag, remote publication or deployment is included.
  The nine known private semantic-negative cases are not weakened or deleted.

### Verification and independent review

Final verification on the reviewed remediation tree:

| Gate | Observed result |
|---|---|
| Pinned self-hosted assets | 27/27 verified (220 MiB) |
| `pnpm verify` | 419/419 unit tests; 10/10 Rust tests; typecheck 0 errors/0 warnings; production build passed |
| `pnpm test:security` (corrected full rerun) | 44/44 passed, 22 per browser, no skips (3.1 minutes) |
| `pnpm test:e2e` | 84/84 passed, 42 per browser, no skips (9.6 minutes); all five previously skipped Firefox workflow bodies executed |
| Original synthetic sanitizer canaries | All five exact repository payloads (direct, indirect, DE, FR, history) pass in the unit suite |
| Final live Mistral generation replay | Seven selected canary requests completed; zero targeted fabricated literals survived; two Study Guide sections quarantined |
| Final live OpenRouter comparison | Two requests attempted; both blocked by `http_429`. Not counted as passes; privacy/routing requirements were not relaxed |
| Independent Sol review | R1–R9 code follow-up READY after correcting the additional quoted-word/outside-possessive case; independently reran 147 focused tests, 10 Rust tests, actual-WASM 13-page provenance and native audio checks |

The real-provider replay covered indirect injection, valid-ID forgery, FAQ,
Study Guide, two-turn history, and podcast-script generation. It used existing
adapters and synthetic sources, with a hard nine-request cap per run and no
automatic retries. There were two runs around the quotation follow-up: 18 total
attempts, 14 completed Mistral generations and four OpenRouter 429 responses.
The final completed requests took about 1.5–8.7 seconds each. This is a literal
canary evaluation, **not** semantic verification, an exact replay of the entire
original campaign, or a live speech-quality/TTS certification. No real TTS was
requested; both adapters' pre-speech boundaries are exercised by actual-browser
mocked-provider tests and real decode/encoding workers.

Measured viewer results from the final full E2E run (20ms heartbeat; host-specific):

| Browser | Valid hidden spans | Maximum main-thread gap | Click-to-verified-render elapsed |
|---|---:|---:|---:|
| Chromium | 5,000 | 28.2ms | 413.5ms |
| Chromium | 50,000 | 32.4ms | 424.7ms |
| Firefox | 5,000 | 31ms | 1085.3ms |
| Firefox | 50,000 | 38ms | 646.6ms |

The unchanged-candidate 50,000-span baseline remeasurement stalled for
6,220ms / 28,104ms respectively. The benchmark uses a valid ~1.2MiB PDF with
100,099 characters parsed by real Rust/WASM and pinned Pdfium, then seeds those
actual pages into a disposable local origin to isolate viewer cost from
embedding. Complete canonical text and citation highlighting are asserted;
per-span decoration is explicitly omitted above the documented budget.

Earlier failures are retained rather than relabelled as successes:

- The independent follow-up found a genuine supported quote followed by an
  outside plural possessive being removed. Five new controls failed before
  the narrow correction; all controls then passed, including prior negatives.
- The first full security run was 42 passed / 2 failed. The existing XSS fixture
  expected `<script>alert(10)</script>` but received the correct numeric/quote
  quarantine notice because 10/11 were absent from its source. The correction
  adds explicit inert 10/11 source evidence while preserving the original
  malicious response and every DOM/citation/reload/key-lifecycle assertion.
  A direct gate toggle demonstrates the cause; focused 2/2 and full 44/44
  reruns passed. No unsupported-value regression was weakened.
- Initial new browser probes had test-only setup errors: repeated Pdfium
  initialization (`RuntimeError: unreachable`) and a mismatched saved-segment
  label. Their corrected lifetimes/assertions pass; no production workaround
  or increased performance tolerance was introduced.

Evidence is retained in the machine-private bundle
`researchbench-remediation-round2-20261015` rather than committing raw provider
traffic or credentials. Key artifacts: `verify-final.log`,
`security-rerun-final.log`, `e2e-final.log`, `live-canaries.json`,
`xss-fixture-toggle.json`, baseline reproduction logs, and the independent
reviewer's focused/provenance/audio outputs. Native browser suites use synthetic
documents and mocked providers; real-provider results are separated above.

Commands (existing pinned Node/pnpm/Rust/Playwright toolchain):

```sh
node scripts/prepare-assets.mjs --verify
node scripts/build-wasm.mjs
pnpm verify
pnpm test:security
pnpm test:e2e
```

Only local signed commits on the remediation branch are authorized. No push,
merge, tag or deployment is part of this round.

---

## Round 1 historical verification (HEAD `5ce5a47` through `a512125`)

The following results and assessments record the first remediation round. They
are **not** the current guarantees: the independent review rejected that round.
In particular, the historical numerical-format, universal quarantine and Firefox
environment explanations below were challenged by reproduced counterexamples.
See the Round 2 section for the replacement policy and verification evidence.

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
