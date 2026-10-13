# Verification and release acceptance

## Reproduce the automated checks

Use the pinned Node, pnpm and Rust versions in the workflow and toolchain file.
Run from the repository root:

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

ResearchBench supplies source passages to generation and validates citation IDs
and source navigation. It does not automatically verify that generated claims
are supported by those passages, or independently fact-check the sources.
Prompt injection can still influence generated wording even
though output is escaped, citations are validated and the key is absent from
prompt content. Claims of source truth or automatic GDPR compliance are outside
this acceptance scope.

### Grounding regression: partial NIST excerpts

The initial genuine-provider acceptance found unsupported elaboration in an
answer explaining the four AI RMF Core functions. The imported PDF contains
only printed pages 20–21. Valid citation IDs accompanied detailed MAP, MEASURE
and MANAGE definitions that those excerpts do not supply. Exact citation spans
and source navigation were intact; citation membership validation checks
identity, not whether a passage supports every assertion.

The shared generation instructions now require support at the specificity of
each factual clause, separate claims with different supporting excerpts, and
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
**Quellenkontext exportieren**). The download contains exactly
`{"sources":[{"id":"C1","page":1,"text":"…"}]}`, projected from that
answer's saved input citations. It includes every selected passage, including
those the answer did not cite. It uses the frozen snapshot after reload or
source changes, without rerunning retrieval or contacting a provider.

The export excludes filenames, notebook metadata, questions, history, API
settings and request headers. IDs are request-local citation aliases, not
original internal chunk IDs. Successful answers already persist this source
snapshot; failed or canceled generations have no saved assistant answer and
no corresponding export. The file proves which source projection was saved
for that answer, not the complete wire request, provider processing or semantic
support. The two supplied original exports can be inspected independently as
Snapshot A and Snapshot B. They omit answer identity and citation assignments,
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
explicit decision; no semantic checker or extractive mode has been added.
Semantic grounding remains **FAIL**: all nine known private forensic regression cases
are accepted when their citation IDs are valid. Keep those cases and rejection
expectations unchanged. These cases are separate from the structural automated
checks above; passing CI does not establish semantic support. The owner accepts
this documented limitation for the
v0.0.3 prototype; it is not a fix or a passing semantic test. UI and demo language
must distinguish source references from verified factual support. Semantic
verification and improved graphic-text extraction remain backlog work.

Before submitting, check the actual public origin and real-provider experience,
record the demo in at most ten minutes, then provide the repository, demo and
video links. Optional WebLLM/WebGPU generation is not implemented.

## Submission acceptance

Keep the v0.0.3 candidate private on GitHub and untagged until the owner
explicitly authorizes publication and tagging. The exact production build must
pass functional and security/privacy acceptance, including the real Mistral
experience. Semantic grounding remains FAIL and is an explicitly accepted
prototype limitation with transparent disclosure; it does not independently
block v0.0.3. This acceptance does not authorize deployment or publication.
The public demo provides its exact commit-bound source archive and AGPL license independently
of repository visibility. Third-party licenses and historical MIT releases
retain their original terms.

Use [the public NIST corpus](public-demo/README.md) and
[the OBS demonstration outline](demo-script.md). Prepare and check every Studio
output, podcast and fallback chat answer before recording. Genuine provider
requests, listening judgments, source grounding, repository visibility, video
upload and submission are owner actions; mock/browser gates do not certify them.
Keep dated gate results and generated-content reviews outside the source tree,
with the exact candidate SHA and artifact identity. No keys, private documents
or infrastructure records belong in the repository.
