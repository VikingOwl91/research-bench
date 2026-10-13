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

The large-model HTTP-cache test uses owned persistent browser profiles with an
explicit cache budget. This demonstrates the immutable URL/cache contract,
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

ResearchBench grounds output in supplied sources; it does not independently
fact-check them. Prompt injection can still influence generated wording even
though output is escaped, citations are validated and the key is absent from
prompt content. Claims of source truth or automatic GDPR compliance are outside
this acceptance scope.

Before submitting, check the actual public origin and real-provider experience,
record the demo in at most ten minutes, then provide the repository, demo and
video links. Optional WebLLM/WebGPU generation is not implemented.
