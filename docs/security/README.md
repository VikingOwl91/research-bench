# Security audits and current limitations

Audits are point-in-time assessments of exact revisions, not certifications.
Original findings and coverage reports are preserved, including failed gates.
The remediation ledger distinguishes later corrections from historical claims.

## Audit and remediation history

| Record | Revision | Status and evidence |
| --- | --- | --- |
| Original 2026-10 Mistral red-team audit | `4fd379dbfd2d0b25881bc219f18c0d66178ad8b3` | [Original report](audits/2026-10-mistral-red-team/README.md), [findings](audits/2026-10-mistral-red-team/findings.md), [coverage](audits/2026-10-mistral-red-team/coverage.md); historical, not a current guarantee |
| First remediation / independent challenge | `a512125510094438b9015e1929743d9d642efb95` | DO NOT MERGE; nine reproduced defects prompted Round 2 |
| Reviewed Round 2 remediation | `4c086feb4da026d5831f22e22555a55a1ad825df` | [Corrections, tests and residuals](audits/2026-10-mistral-red-team/remediation.md#review-round-2--2026-10-15); merged by PR #3 at `a77310d3048dfb267462294ee0904ee2d0b8921b` |
| 50-source import and refresh follow-up | `1d5231568f00ea6c8fc0b86583e3370077c2e822` | [Phase A handoff](../source-capacity-phase-a.md); merged by PR #4 at `8836b098984656ef64cac13ddd228e2766f0b6bd`; no change to generation safeguards |

The Round 2 ledger supersedes Round 1 claims, including overly broad numeric,
quarantine and Firefox-environment explanations. A failure observed at a
baseline is not by itself evidence that its cause is environmental.

## Current protection and remaining uncertainty

The selected source IDs, source spans, provider boundaries, schema limits and
local revision guards are checked deterministically. All new text-generation
paths use sentence-level source sanitization and a numeric/literal-quotation
presence gate. Paused podcasts are checked against frozen evidence before new
speech. Output is escaped text; providers have no tools or API key in prompt
content. These measures reduce tested attack paths without proving semantic
support.

Known limitations include:

- Unsupported prose, invented names, false conclusions using existing numbers,
  single-significant-digit values and answer/script titles can survive.
- Number formatting and ambiguous quotation punctuation can cause false positives
  or false negatives. Legitimate discussion of injection instructions can be
  filtered before transmission. EN/DE/FR patterns do not cover all languages,
  encodings or paraphrases. Accepted prose can contaminate later turns.
- Historical ready output is not retrospectively certified. Unsafe paused drafts
  are rejected on resume rather than rewritten against their existing audio.
- PDF render-mode/paint annotations are incomplete. Unknown paint data,
  alignment fallback, clipping, backgrounds, overlays and blend modes prevent a
  complete visibility inference. Above 1,000 spans, the viewer explicitly omits
  individual decorations without dropping extracted text or citation highlights.
- The five-minute worker watchdog is an inactivity deadline, not a total
  resource budget. Browser quota/cache behavior and large-file UI pauses remain
  device-dependent.
- The internal storage API byte-limit omission remains a low-severity
  defense-in-depth item; see the [reachability analysis](../source-capacity-phase-a.md#pre-existing-storage-byte-limit-gap).

Round 2's live OpenRouter replay was blocked by HTTP 429 and is not a pass. Real
TTS was not rerun in that round. Synthetic browser playback and pre-speech tests
do not establish live voice quality, billing or current account entitlements.
The nine original private semantic-negative cases remain historical evidence of
the support gap; structural CI does not certify them as semantic passes.

## Reproduce and report

Run the gates in [verification.md](../verification.md), then assess the exact
revision and actual provider configuration. Passing tests do not carry an old
audit forward or certify a production deployment.

Use [SECURITY.md](../../SECURITY.md) for reporting requirements and the private
reporting-channel prerequisite before publication. Do not commit raw private
traffic, keys, user documents or infrastructure records as audit evidence.
