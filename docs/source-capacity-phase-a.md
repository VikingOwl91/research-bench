# v0.1.0 Phase A: 50-source notebooks

Implementation baseline: `a77310d3048dfb267462294ee0904ee2d0b8921b`.
Branch: `feat/v010-source-capacity`. Implementation commit:
`71b150d10bb2dc2a13b58d4ea109f3e2d73576e2` (signed).
This is a local implementation milestone, not a release or deployment.

## Changes and invariants

- Up to 50 sources per notebook. The 10 MiB per-file, 500,000 canonical-character,
  1,000-chunk and 24,000-character context limits are unchanged.
- EN/DE `used / 50`, remaining, final-slot and full-notebook messages. Import and
  refresh controls precede the source list, including on mobile with 50 rows.
- The chooser is disabled at capacity. A full-notebook drop reports the limit.
  Controller preflight reads the persisted count/revision before reading file
  bytes or indexing. The existing write transaction remains authoritative.
- Imports stay sequential and stop at the first failure or capacity boundary.
  A transient per-file report distinguishes imported, failed, canceled and
  not-attempted files. Committed files remain imported if cancellation follows.
- Refresh sources explicitly reloads stale tabs. Reopening the notebook remains
  available. Changed revisions clear stale local search hits; refresh cannot
  cancel busy work or publish into a newer notebook/job.
- IndexedDB remains version 2. No migration, embedding-version change, generation
  contract change, provider change, dependency change or unrelated cleanup.

Two tabs can both observe 49 sources and start indexing. Exactly one can commit
its final source; the other reports a revision conflict without orphan records.
Preventing that race-losing indexing would require reservations or locking, which
this phase does not introduce. Known excess files are not read or indexed.

## Regression coverage

`tests/unit/import-capacity.test.ts` adds 29 focused cases: 0/1/49/50 reopening,
49→50 and rejected 51st source, batches crossing capacity, stale persisted counts,
competing database connections, external deletion and refresh, delete/reimport,
exact/exceeded existing limits, incompatible embeddings, invalid files, quota
rollback, active/read-time/post-commit cancellation, stale reports and view fences.
Indexing is mocked in these unit tests; real parsers/embeddings are covered below.

`tests/e2e/source-capacity.spec.ts` adds three integration cases in each browser:
real final-slot imports, excess/drop non-reading, batch feedback, deletion/reopen;
two-tab final-slot contention and recovery after external deletion; EN/DE,
light/dark, 320/375/430/768px, focus reachability, overflow and axe checks with 50
source rows. An existing native quota test additionally checks import accounting.
Browser count/layout fixtures use valid seeded vectors; final-slot imports use the
real worker. Screenshots are local evidence under `.cache/phase-a/`.

The original security audit and semantic-grounding negative fixtures are untouched.
No semantic verification claim is added by this change.

## Reproduce verification

Use the pinned toolchain and assets described in the main README. These commands
use disposable browser contexts and loopback servers; they require working native
audio for existing playback tests and make no real provider calls.

```sh
node scripts/prepare-assets.mjs --verify
pnpm wasm:build
pnpm verify
pnpm source:prepare --expected-head "$(git rev-parse HEAD)"
pnpm test:e2e
pnpm test:security
pnpm exec playwright test --config playwright.capacity.config.ts
CAPACITY_HIGH_BYTES=1 pnpm exec playwright test --config playwright.capacity.config.ts
```

Source preparation requires a clean committed tree. Measurements must run alone,
without concurrent builds or browser suites. `TMPDIR=/dev/shm` was used locally to
avoid the machine's temporary-file quota; it is not an application requirement.
No tests are skipped or given retries by the new measurement harness.

## Performance methodology

See [harness instructions](../tests/performance/README.md) and the committed raw
JSON under [performance/source-capacity](performance/source-capacity/).

The same 50 fictional CC0 PDF page texts are packaged as 10×5-page files or
50×1-page files. Both yield exactly 34,322 canonical characters and 50 real
384-dimensional E5 chunks. Canonical page/chunk hashes must match. Two balanced
rounds (10→50 and 50→10) begin in fresh contexts; the preceding notebook is deleted
between paired trials. This separates source count from total text/chunks without
claiming to test the worst-case 500,000-character/1,000-chunk workload.

Four frozen EN/DE retrieval questions are repeated three times per trial; first
post-index and post-reload searches are separate samples. Warm worker timings
exclude the Playwright UI polling overhead (roughly 100ms granularity). Reload is
navigation through restored source rows, not reload plus first embedding-model
startup. Actual query samples, top-six result hashes and expected ranks are saved.

Storage estimates include model CacheStorage and browser overhead; exact original
Blob bytes are separate. Request routing disables Playwright HTTP caching. The
harness records cache names rather than assuming model retention. A 25ms main
thread timer observes responsiveness. Chromium's nonstandard `performance.memory`
is main-realm heap only; Firefox exposes no equivalent supported measurement.
Neither is a reliable total process/worker/WASM peak or a low-memory-device test.

Studio coverage invokes the unchanged `generatorContext` on actual persisted
source/page/chunk data in the test process. It records selected source IDs,
passages and character counts. It does not generate an artifact or certify an
actual provider response. Chat retrieval measures actual browser top-six results.
There are no real provider calls, keys or generated-answer quality measurements.

A separate scenario imports 50 valid PDFs, each 10 MiB minus 1 KiB, sequentially.
Their large unreferenced streams are highly compressible zero padding. Exact Blob
sizes and reload persistence are checked, but this is not representative of all
image-heavy PDFs or worst-case physical disk/memory pressure. Any real browser
rejection would require unchanged failed-file records/revision. None occurred;
quota rollback is instead covered by unit and native injected-failure tests.

## Known limits and independent-review handoff

- All existing text, chunk, context and browser-storage constraints still apply.
  There is no aggregate-notebook-byte guarantee, and 50 near-limit files need not
  fit on other devices. Browser eviction and private-mode quotas remain external.
- Context selection is bounded. Do not imply every source participates in every
  answer. Retrieval controls only test the frozen synthetic fixture, not general
  retrieval quality or semantic grounding.
- Cancellation responsiveness is an early-import click and a 500ms late-write
  observation. Commit-boundary cancellation is covered deterministically in unit
  tests, rather than presented as a measured mid-embedding timing guarantee.
- Accessibility checks are scoped to these controls and existing browser suites;
  they do not establish full WCAG conformance or physical mobile-keyboard testing.
- Remote CI, independent final review and maintainer acceptance are separate gates.
  No push, merge, tag, release, deployment or visibility change is part of Phase A.

Review `a77310d..71b150d` for transaction invariants, cancellation accounting,
refresh/report identity fences, pre-read capacity enforcement and localized UI.
Re-run the boundary/race unit cases and six integration cases, then inspect raw
measurements separately from this summary. Compare final evidence/test-only
commits separately; preserve the original audit and generation/grounding fixtures.

## Clean-commit measurement results

Measured code/build: `71b150d10bb2dc2a13b58d4ea109f3e2d73576e2`,
production tracked patch empty, build manifest SHA-256
`9a4f1167c80cc0270adce705d21ac27dc64aafa6693199ebb6d51c9576fec05e`.
This includes the prepared corresponding-source archive. Later evidence/documentation and test-only
commits do not change application code. Linux x64, 16 logical CPUs, 33,556,733,952
bytes system RAM; Chromium 156.0.8078.4 and Firefox 157.0, headless desktop viewport
1440×1000. These are local observations, not remote CI results.

| Browser | Source count | Index UI-ready median | Chunks/s from index median | Warm search worker median | Warm search UI median | Reload median |
|---|---:|---:|---:|---:|---:|---:|

| Chromium | 10 | 9.637s | 5.19 | 26.00ms | 114.12ms | 126.75ms |
| Chromium | 50 | 10.339s | 4.84 | 27.05ms | 118.25ms | 126.50ms |
| Firefox | 10 | 11.206s | 4.46 | 29.25ms | 120.00ms | 184.33ms |
| Firefox | 50 | 12.082s | 4.14 | 29.00ms | 127.25ms | 203.94ms |

Each count has two balanced trial samples and 24 repeated warm-query samples per
browser. Compared with 10 sources, 50-source warm worker search changes by +4.0%
(Chromium), −0.9% (Firefox); UI warm-search changes by +3.6% and +6.0%; reload by
−0.2% and +10.6%. The prior corrected-harness run also stayed below 20% (warm worker
search +2.7%/+2.6%, reload −2.6%/+3.5%). **No reproducible >20% warm-search or reload
regression was observed; no threshold waiver or unrelated optimization is proposed.**
Two trial samples are insufficient for statistical or machine-independent claims.

All 56 retrieval checks per browser (112 total, including first queries) found the
expected fact at rank 1 among six hits. Canonical text/chunk hashes matched all
trials. Selected Studio context: 10/10 sources, 23,999 characters versus 35/50,
23,997 characters; both of 34,322 available characters. The 24,000 limit is retained.

Original PDFs total 56,312B versus 70,772B because packaging is different. Chromium
reported IndexedDB usage 368,640B versus 421,888B (+53,248B), plus a retained
135,395,486B model cache. Firefox origin usage was approximately 124.41MB versus
126.34–126.42MB, with no per-store usage API. These estimates include bookkeeping
and cannot be treated as portable source-record byte sizes.

Maximum small-corpus index heartbeat gaps: 32.4ms Chromium / 37ms Firefox (25ms
sampling interval). Early-import cancel-to-ready: 42.4ms / 54ms; zero committed
sources and no late writes during the following 500ms. Chromium main-realm heap
readings were coarsely quantized at 10,000,000B and do not establish actual memory
use or absence of growth. Firefox memory observation is unsupported.

### Harness corrections, not application fixes

Two early attempts failed before the valid measurements: a PDF line break made the
literal expected phrase `four degrees Celsius` fail a substring match, and an
initializer tried localStorage on an opaque initial `about:blank` document. The
first now collapses whitespace only, preserving the expected fact and query. The
second returns before instrumentation unless the origin is the exact loopback
target; page errors on the application origin still fail. An isolated Chromium
probe reproduced the storage exception only with the unguarded initializer.
Original failed/partial reports and logs remain local under
`.cache/phase-a/first-measured/`; they are not passing product evidence. No
production changes, query weakening, retries or browser skips resolved them.

### Separate high-original-byte result

Both browsers accepted and reopened 50/50 sources with 50 chunks and exactly
524,236,800 logical original bytes (50 × 10,484,736B). Zero external requests or
page errors occurred. Summed per-file UI-ready times were 63.66s Chromium / 31.84s
Firefox, including automation transfer, cold model startup, application storage
refresh and harness storage inspection. Origin estimates were 398,133,406B / 648,387,359B; Chromium's reported IDB
usage was 262,737,920B, explicitly demonstrating why logical original bytes cannot
be equated to physical storage for this compressible fixture.

The largest heartbeat gaps were 871.3ms / 286ms. The first observed run also had
large-payload gaps (1,065.5ms / 286ms). This is a reproducible responsiveness cost
in the high-byte workflow, not a claim of uninterrupted UI. Buffer-based
Playwright uploads serialize and create a 10MiB file in the page; the heartbeat
includes that overhead, harness IndexedDB inspections and application work. This
harness does not isolate those contributions. Disposition: record this boundary limitation, retain sequential
imports and explicit cancel feedback, and request reviewer assessment; do not
conceal it with overflow controls, virtualization or speculative storage changes.
The required >20% warm-search/reload comparison uses the equal-text workload, where
no such regression was observed. It does not waive these large-input pauses.

## Verification outcomes and recommendation

On implementation commit `71b150d`:

| Gate | Actual result | Local log |
|---|---|---|
| `pnpm verify` | 448 unit / 10 Rust passed; typecheck 0 errors/warnings; production build passed | `.cache/phase-a/verify-candidate.log` |
| Pinned assets / WASM rebuild | 27 assets verified; Rust/WASM build passed | `.cache/phase-a/assets-verify.log`, `wasm-build.log` |
| Corresponding-source preparation | Passed for exact clean implementation commit | `.cache/phase-a/source-offer-candidate.log` |
| Full `pnpm test:e2e` | 90 passed: 45 Chromium + 45 Firefox; no skips (9.3min) | `.cache/phase-a/e2e-candidate.log` |
| Full `pnpm test:security` | 44 passed: 22 Chromium + 22 Firefox; no skips (2.8min) | `.cache/phase-a/security-candidate.log` |
| Equal-corpus performance | 2 passed, both browsers (2.1min) | `.cache/phase-a/capacity-candidate.log` |
| High-byte observation | 2 passed, both browsers (1.7min); observed 50/50 and reload | `.cache/phase-a/high-bytes-candidate.log` |
| Strengthened visible-button/native-chooser integration | 2 passed, both browsers (15.9s); no application change | `.cache/phase-a/chooser-final.log` |

The last focused rerun strengthens the first capacity case by using the visible
Add sources button and actual file-chooser event rather than setting the input
directly. No expected results or other tests were relaxed. All remaining capacity
cases already passed in both the initial focused run and full E2E suite.

The application diff, unchanged limit object (apart from source count), unchanged
IndexedDB schema, unchanged generation/context/support-gate code, original audit
and existing security/grounding fixtures were inspected. `git diff --check` passed.
Newly committed evidence contains only the fictional corpus and sanitized machine
observations; prior failed harness logs stay outside Git. Signing verification of
the implementation commit passed. Remote repository privacy and unchanged remote
`main` baseline were checked; the feature branch is local only.

**Recommendation: READY for independent review, not authorized for merge/release.**
No unexpected regression remains from the executed gates. The reviewer should
explicitly assess race-losing indexing, high-byte responsiveness and the stated
measurement limits. Independent final review and remote CI have not run. Stop here
for that review; Phase B cleanup and public-release preparation have not started.
