# Verification and release acceptance

## Reproduce the automated checks

Use the pinned Node, pnpm and Rust versions in the workflow and toolchain file.
The recorded preparation toolchain is Node.js 26.11.1, pnpm 11.28.5 and
Rust 1.98.1. Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm assets:prepare
pnpm assets:prepare -- --verify
pnpm wasm:build
pnpm verify
pnpm exec playwright install chromium firefox
pnpm test:e2e
pnpm test:security
```

`verify` includes Svelte/TypeScript diagnostics, unit tests, native Rust tests
and the static production build. Browser tests use fresh, isolated Chromium and
Firefox profiles. They do not access an existing user tab or its API keys.
Provider endpoints are intercepted with original synthetic fixtures and dummy
keys; no real provider requests or spending are needed. CI provisions an
isolated UNIX-socket audio null sink for native playback; it does not replace
audio decoding, clock progression or player error assertions.

## Covered behavior

- Actual Rust/PDFium parsing, local multilingual E5 indexing and retrieval,
  exact source spans, cancellation/retry, persistence and notebook isolation.
- Both chat adapters, Summary/FAQ/Study Guide schemas, context membership,
  source revisions, malformed responses and safe error messages.
- English interface defaults, persisted German selection, language changes
  during operations, unchanged stored source names and audio playback.
- Podcast scripting, WAV/PCM/MP3 decoding, resampling, gain, the production MP3
  encoder Worker, playback/seek/download and contribution-level timestamps.
  Paused seeks are checked at fractional MP3 boundaries for both speakers;
  a one-sample offset avoids browser clock rounding without changing pauses.
- Atomic audio/metadata publication, quota rollback, stale render identities,
  key removal/replacement and provider changes during generation, resume and
  multi-tab locking, including release when the owning tab closes.
- Malicious documents, filenames and generated text; fabricated citations;
  session-key lifecycle and wipe; bounded voice pagination/audio payloads.
- Source-count boundaries, native chooser/drop accounting, capacity-crossing
  batches, transactional last-slot competition, deletion/reimport, and fenced
  overlapping refreshes in Chromium and Firefox. See the [Phase A handoff](source-capacity-phase-a.md).
- Deterministic numeric/quotation gate regressions and their supported controls,
  persisted-podcast resume rejection before new TTS, and actual-Pdfium paint-channel
  provenance with bounded source-viewer segmentation. These test selected literal
  failure classes, not semantic entailment.
- Actual document HTTP CSP plus early hashed meta CSP, worker response policy,
  permitted WASM execution in Workers, and denied main-thread WASM, evaluation,
  arbitrary inline scripts, blob Workers and framing.

The instrumented runtime check also runs the unchanged production pipeline.
Rust, PDFium and ONNX compile in the pipeline Worker; the audio encoder is
JavaScript and needs no additional WASM permission. Zod is configured without
JIT before constructing schemas, avoiding dynamic-code probes under CSP.

The large-model HTTP-cache test uses owned temporary persistent profiles in
full Chromium and Firefox, with an explicit 1-GiB cache budget. This demonstrates
the immutable URL/cache contract,
not guaranteed retention in every default browser profile. CacheStorage reuse
is tested separately. Browser eviction or user deletion can require another
model download.

Expected HTTP-error console entries are matched to the exact mocked endpoint
and status in failure-path tests. Other console errors, unhandled exceptions,
unexpected network requests and unexpected CSP violations fail acceptance.
Successful hosting flows require zero such errors.

## Exact-source production artifact

Build from a clean committed checkout. Supply its full commit SHA when freezing
and verifying the candidate:

```sh
pnpm build
pnpm source:prepare --expected-head <full-commit-SHA>
pnpm release:prepare build .cache/releases --require-clean --expected-head <full-commit-SHA>
pnpm release:verify <release-directory> --require-clean --expected-head <full-commit-SHA>
pnpm hosting:check --url <https-origin> --release <release-directory>
RESEARCHBENCH_HOSTING_URL=<https-origin> pnpm test:hosting
```

Strict release checks bind provenance and the compiled SvelteKit version to that
SHA and reject dirty source, stale builds or altered site bytes. The hosting
checker streams every file and verifies lengths, hashes, MIME/cache/security
headers, effective policy intersections, SPA navigation and missing-asset 404s.
The browser suite exercises actual parsing, embeddings, generation fixtures,
audio playback/download and security denials on the selected hosting origin.
It does not weaken certificate validation.

## Reproducibility and rollback gates

A release candidate is built twice in independent clean checkouts of the same
SHA with pinned tools and assets. Compare the site manifests and file bytes;
informational preparation timestamps are not part of that comparison.
Identical bootstrap hashes are expected when the builds are deterministic.
Compare the **complete** site inventories, not only bootstrap files. When a source
archive differs, compare compressed hashes, decompressed tar bytes and every member
path, mode and content hash separately. Compression-toolchain variance is not the
same as a source-tree difference. See [v0.1.0 release preparation](release-v0.1.0.md).

Rollback uses two different, fully checked commits: a hardened baseline and the
new release candidate. Rehearse baseline → candidate → deliberately broken CSP
→ baseline → candidate in an isolated production-server environment. The broken
policy is never installed on the public demo. After rollback, repeat the exact
artifact, security and functional checks, including fresh browser contexts.
An already loaded document retains its original CSP after a server rollback;
verify that navigation/new contexts receive the restored policy.

The release tag labels the exact commit whose artifact passed live acceptance.
CI success, a prepared artifact and a deployed release are separate results.
Deployment configuration and private operational receipts are outside this
repository.

## Manual acceptance and limits

The owner accepted the English voice probe and the podcast feature. German
voices retain a noticeable accent and remain explicitly experimental; local
speed/gain changes do not provide native German voices. Full real-voice episode
quality, transitions, pronunciation and live account routing/billing require
listening with a user-owned key. Automated synthetic tones cannot establish
those properties.

ResearchBench supplies selected, heuristically sanitized passages to generation,
validates citation IDs/source navigation, and quarantines some unmatched numeric
literals or quotations. It does not verify semantic claim support or independently
fact-check the sources. The gate can both miss unsupported claims and remove
supported wording. [Current residuals](security/README.md) apply to all generation
paths; historical ready output is not retrospectively checked.
Prompt injection can still influence generated wording even
though output is escaped, citations are validated and the key is absent from
prompt content. Claims of source truth or automatic GDPR compliance are outside
this acceptance scope.

### Historical v0.0.3 grounding regression: partial NIST excerpts

The following records the prompt-only stage and its private forensic cases.
It predates the merged deterministic support gate. It remains evidence of the
semantic limitation, not a description of all current validation logic. The
[Round 2 ledger](security/audits/2026-10-mistral-red-team/remediation.md#review-round-2--2026-10-15)
records the subsequent heuristic controls, false positives and bypasses.

The initial genuine-provider acceptance found unsupported elaboration in an
answer explaining the four AI RMF Core functions. The imported PDF contains
only printed pages 20–21. Valid citation IDs accompanied detailed MAP, MEASURE
and MANAGE definitions that those excerpts do not supply. Exact citation spans
and source navigation were intact; citation membership validation checks
identity, not whether a passage supports every assertion.

At that stage, the shared generation instructions were changed to require support
at the specificity of each factual clause, separate claims with different supporting excerpts, and
explicitly acknowledge missing details. Prior answers are bounded follow-up
data, never current evidence. These rules cover chat, Summary, FAQ, Study Guide
and podcast scripts without expanding the imported corpus or retrieval.
Search previews mark clipped fragments and remove cut word edges where
possible; the indexed text and citation offsets remain unchanged.

Repeat the original question against the same two imported sources:

> How does the NIST announcement describe the purpose of the AI RMF, and how
> does the framework's Core turn that purpose into practical risk management
> activities? Explain the four functions and how they work together.

Check every factual clause against its selected citation, including how the
functions work together. Naming a function does not substantiate its detailed
definition. Follow up by asking which specific MAP, MEASURE and MANAGE duties
the supplied excerpts describe; missing duties must remain explicitly missing.
The GOVERN discussion on printed page 21 does contain policies, culture and
third-party legal issues: judge the selected passage rather than rejecting all
legal discussion. Unit and mocked-browser checks verify request boundaries and
source integrity, not real-model entailment. This retest documents model
behavior; it is not an implemented semantic verification gate. Genuine-provider
functionality and review of the content chosen for the demonstration remain
required; semantic claim-level grounding is an accepted v0.0.3 prototype
limitation, not a mandatory release criterion.

The genuine Mistral retest of `beb0ff4` still produced unsupported MAP,
MEASURE, MANAGE and GOVERN details. The prompt-only correction did not pass
semantic acceptance. Controlled provider fixtures reproduce a separate,
deterministic failure: the local validator accepts those additions when their
citation IDs are valid. This demonstrates the validation gap, not how the real
provider internally produced its response.

Figure 5 on printed page 20 contains short function descriptions visually.
Both PDFium and independent text extraction omit that diagram text. The model
receives extracted text, not the original page image. Do not confuse facts
visible in the uploaded PDF with passages actually transmitted to the model;
the diagram does not substantiate the additional detailed duties either.

### Local source-context diagnosis

Every completed chat answer has **Export source context** (German:
**Quellenkontext exportieren**). The download contains
`{"sources":[{"id":"C1","page":1,"text":"…"}]}`, projected from that
answer's saved input citations. It includes every selected passage, including
those the answer did not cite. It uses the frozen snapshot after reload or
source changes, without rerunning retrieval or contacting a provider.

The export excludes filenames, notebook metadata, questions, history, API
settings and request headers. IDs are request-local citation aliases, not
original internal chunk IDs. Successful answers already persist this source
snapshot; failed or canceled generations have no saved assistant answer and
no corresponding export. The file records which source projection was saved
for that answer, not the complete wire request, provider processing or semantic
support. With the current sanitizer, transmitted sentence text can differ from
the original text in those frozen citations. It is not a wire-level proof. The two supplied original exports can be inspected
independently as Snapshot A and Snapshot B. They omit answer identity and citation assignments,
so their correspondence to the two original answers remains unknown. This
evidence gap is accepted for the prototype; no further original-data extraction
is required. Controlled reenactments do not replace original evidence.

A deterministic allowed-ID check proves membership. An exact-quotation check
can prove that quoted text was supplied, but not that it supports accompanying
generated prose. Keyword overlap also permits negation inversions and assigning
a GOVERN statement to MAP. Restricting factual output itself to quotations
would restrict factual wording without guaranteeing appropriate attribution,
while changing paraphrasing,
translation and podcast behavior. Such a product-contract change needs an
explicit decision; no semantic entailment checker or extractive mode has been added.
The later lexical support gate is not such a checker.
The historical semantic grounding result was **FAIL**: all nine known private
forensic cases were accepted when their citation IDs were valid. This is not a
fresh semantic evaluation of the v0.1.0 candidate. Keep those cases and rejection
expectations unchanged. These cases are separate from the structural automated
checks above; passing CI does not establish semantic support. The owner accepts
this documented limitation for the
v0.0.3 prototype; it is not a fix or a passing semantic test. UI and demo language
must distinguish source references from verified factual support. Semantic
verification and improved graphic-text extraction remain backlog work.

Before submitting, check the actual public origin and real-provider experience,
record the demo in at most ten minutes, then provide the repository, demo and
video links. Optional WebLLM/WebGPU generation is not implemented.

## v0.1.0 candidate acceptance

Keep the repository private. Local preparation and verification do not authorize
push, merge, a signed tag, a GitHub Release, publication or deployment. The
[release checklist](release-v0.1.0.md) separates those gates. Historical v0.0.3
and audit counts above must not be presented as candidate results.

The approved Phase A merge `8836b098984656ef64cac13ddd228e2766f0b6bd`
passed remote branch, PR and post-merge checks: 454 unit, 10 Rust, 92 browser E2E
and 44 security cases, with zero browser skips. This is baseline evidence;
current cleanup-candidate results must be recorded separately with their exact
commit and environment. Never infer a pass from an expected count.

For this candidate, require local unit/Rust, typecheck/build, WASM/pinned assets,
Chromium/Firefox E2E/security without skips, fresh-clone build/source checks,
license/dependency/disclosure review and independent review. Record unexpected
failures, false positives, missing live-provider coverage and unresolved risks.
The nine original semantic-negative fixtures remain unchanged. Their semantic
failures are accepted prototype limitations, not newly passing semantic tests.

The public demo offers its exact commit-bound source archive and AGPL license
independently of repository visibility. Third-party licenses and historical MIT
releases retain their terms. Public reporting availability, historical disclosure
acceptance and publication are explicit maintainer decisions. No keys, private
documents or infrastructure records belong in committed verification evidence.

The [public NIST corpus](public-demo/README.md) and [OBS outline](demo-script.md)
remain available for the original assignment. Review prepared outputs and listen
to the podcast before recording. Real provider requests, account entitlements,
voice judgments, video publication and submission are separate manual actions;
mock/browser gates do not certify them. Optional WebLLM/WebGPU generation is not
implemented.
