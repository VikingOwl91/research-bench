# Remediation backlog — 2026-10 Mistral red-team audit

Baseline: `4fd379dbfd2d0b25881bc219f18c0d66178ad8b3` (v0.0.4).
All items are **OPEN**: no remediation has been implemented or re-tested as
part of this audit. Fix and re-test commit SHAs are intentionally blank.

Priority order: P1 (blocks a trustworthy v0.1.0), P2 (should land in
v0.1.0), P3 (backlog).

## P1 — Generation integrity (shared root cause of RB-RT-001..004)

### RB-RT-001 / RB-RT-002 / RB-RT-003 / RB-RT-004 — claim-support (entailment) checking

- **Priority:** P1
- **Proposed remediation:** implement a support check between generation and
  publication. Concretely, the project's own documented direction: a
  verification pass (second model call or a local check) that flags answer
  clauses not supported by their cited excerpts, with unsupported clauses
  removed or explicitly labeled before the answer/artifact/episode is
  persisted. Interim hardening if the full check is too large for v0.1.0:
  strengthen the UI so citations are always labeled "source reference",
  never "verified"; add the system-prompt rule that instructions embedded in
  source text are never executed (partially present); and add the live
  injection canaries below.
- **Regression-test requirements:**
  - deterministic mocked-provider fixtures for unsupported claims with valid
    citation IDs in chat, Summary, FAQ, Study Guide, and podcast turns
    (extend the existing invalid-citation fixtures);
  - live-provider canary: upload the indirect-injection fixture, run chat
    (both phrasings), FAQ, Study Guide, and a podcast script; assert the
    fabricated value (99 mg/L / "completely safe" / "certified safe for
    unlimited overcharging") never appears as an asserted fact — on both
    providers;
  - two-turn history canary (RB-RT-004): assert the fabricated sentence
    appears in neither turn.
- **Status:** OPEN
- **Fix commit SHA:** —
- **Re-test commit SHA and result:** —

## P2 — v0.1.0 hardening

### RB-RT-005 — mark non-visible extracted text in the source viewer

- **Priority:** P2
- **Proposed remediation:** Pdfium text extraction can report per-character
  render mode/color; carry a "not visible in the original rendering" marker
  for invisible/white spans into the viewer (and optionally into search
  snippets). Do **not** exclude invisible text from indexing (OCR and
  accessibility layers depend on it). If per-span metadata is unavailable
  in the pinned pdfium-render version, document the behavior prominently in
  the UI instead.
- **Regression-test requirements:** fixture PDF with invisible and white
  text; assert the viewer marks or the documentation discloses the
  extraction; assert hidden text remains searchable (no regression for OCR
  layers).
- **Status:** OPEN · **Fix SHA:** — · **Re-test:** —

### RB-RT-006 — make the advertised character limit achievable

- **Priority:** P2
- **Proposed remediation:** either raise the five-minute indexing watchdog
  (it bounds runaway jobs; indexing is legitimately long), improve embedding
  throughput (larger batches within memory bounds), or lower the
  advertised `LIMITS.characters` to the practically achievable range and
  say so in the UI.
- **Regression-test requirements:** CI timing test indexing a
  ~250k-character source within the watchdog on the slowest supported
  browser; a UI copy test asserting the documented limit matches the
  enforced limit.
- **Status:** OPEN · **Fix SHA:** — · **Re-test:** —

### RB-RT-009 — explain staleness aborts

- **Priority:** P2
- **Proposed remediation:** when a generation is aborted because the notebook
  revision, provider config, or data epoch changed (distinct from an explicit
  user cancel), publish a short notice ("aborted because the sources or
  settings changed") instead of silently clearing the progress indicator.
- **Regression-test requirements:** e2e: delete a source mid-generation and
  assert the notice appears and no answer is saved; switch provider
  mid-generation and assert the same.
- **Status:** OPEN · **Fix SHA:** — · **Re-test:** —

## P3 — Backlog

### RB-RT-007 — Firefox model-cache and test-suite failures

- **Priority:** P3
- **Proposed remediation:** investigate Firefox CacheStorage/HTTP-cache
  behavior for the 118 MB model asset (e.g., shard the model below Firefox's
  cache entry limits, or add an explicit CacheStorage fallback path), or
  scope model-heavy tests to Chromium with a documented reason and a
  Firefox smoke subset.
- **Regression-test requirements:** a Firefox model-cache test with a
  generous timeout asserting one network fetch across reload, or explicit
  Chromium-only markers with the reason recorded.
- **Status:** OPEN · **Fix SHA:** — · **Re-test:** —

### RB-RT-008 — document and report extraction coverage

- **Priority:** P3
- **Proposed remediation:** document that limits and model context apply to
  *extracted* text; consider reporting extraction coverage (extracted
  characters vs. pages) for very large PDFs so silent drops are visible.
- **Regression-test requirements:** fixture PDFs asserting extracted
  character counts are reported and bounded in both directions (stacked-run
  drop; separator inflation).
- **Status:** OPEN · **Fix SHA:** — · **Re-test:** —

## Cross-cutting recommendations (not tied to a single finding)

1. Add the live-provider injection canaries (P1) to a scheduled, budget-
   capped CI job or a manual release checklist — the current suites mock
   providers and cannot catch instruction-hierarchy regressions.
2. Keep the audit workspace pattern: synthetic fixtures, full traffic
   capture, credential redaction, egress monitoring. It produced the only
   evidence that matters for the generation-integrity surface.
3. Re-run this audit (or the P1 canaries) after any change to
   `grounding-instructions.ts`, `providers.ts`, `podcast-providers.ts`, or
   the context builders — those files are the injection attack surface.
