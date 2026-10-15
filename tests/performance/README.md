# Phase A browser measurements

Build the current application first, then run from the repository root:

```sh
pnpm build
pnpm exec playwright test --config playwright.capacity.config.ts
CAPACITY_HIGH_BYTES=1 pnpm exec playwright test --config playwright.capacity.config.ts
```

The dedicated server uses loopback port 4183, the production build, one browser at a time, no retries, and the existing local browser installation. The harness aborts every non-loopback request. It uses no API key, provider mock, external model fetch, fake embedding, or persistent user profile. Reports are written incrementally to `.cache/phase-a/{chromium,firefox}-{capacity,high-bytes}.json` and contain synthetic text, browser versions, OS family/architecture and aggregate machine capacity; no absolute paths, private hosts, browser profiles or credentials.

The default comparison has two balanced rounds: 10 then 50 sources; 50 then 10. Each round begins in a fresh browser context. Its second trial deletes the preceding notebook through the application UI and imports a new notebook in the same context. Model CacheStorage may be warm; worker initialization recurs. Playwright request routing disables HTTP caching. Actual cache names and origin storage estimates are recorded rather than assuming model retention.

Both partitions contain exactly the same 50 fictional CC0 PDF page texts. The harness requires 50 real indexed chunks, identical canonical page and chunk hashes across all trials, finite 384-dimensional model vectors, schema 2, reload persistence, and expected facts in top 6 for the frozen English/German queries. The first post-reload query is reported separately from three repeated warm searches per question. Both individual samples and medians remain available.

Index duration includes real upload, PDFium extraction, local E5 embeddings, IndexedDB persistence, refresh and UI readiness. Worker operation timings observe real browser Worker request/results without changing payloads or the production bundle. A disposable init script records a 25ms main-window heartbeat and presence of an enabled cancel button. A separate real cancellation click checks readiness and absence of late writes during a 500ms observation. These timings do not impose a machine-independent performance threshold.

Studio context is the actual unchanged `generatorContext` function invoked in the test process with the actual persisted source/page/chunk inputs. Its selected citations and coverage are reported, including the 24,000-character bound. This measures deterministic context selection; it does not create an artifact or evaluate generated answers. No provider call is made.

The optional high-byte scenario imports 50 valid searchable PDFs, one at a time, each exactly 10 MiB minus 1 KiB. Most bytes are a valid unreferenced PDF stream, so extracted text and chunk counts remain small. This isolates original-blob storage pressure from text/chunk limits. It records each accepted source, original bytes, quota estimate, memory observation and any UI failure. On browser rejection it requires unchanged notebook revision, sources, chunks and original bytes for the failed file. It then reloads accepted records. `status: observed` with a rejection outcome means an honest capacity limit was measured, not that 50 large files succeeded. A harness/browser crash produces `status: failed`, with partial metrics only.

Storage quota/usage estimates are origin-level browser observations. They include retained model caches and browser overhead and are not exact original-byte accounting. Exact original blob bytes are reported separately. No run establishes an aggregate-byte support guarantee. `performance.memory`, when available, is a nonstandard main-realm heap observation; it excludes reliable total-process/worker/WASM peak accounting. Firefox unsupported memory APIs are labeled explicitly.
