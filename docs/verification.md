# Local acceptance — 12 October 2026

The application was implemented and checked locally. This report covers local
v0.0.1 acceptance; deployment and live provider acceptance are separate gates.

## Executed checks

| Check | Result |
| --- | --- |
| `RUSTC_WRAPPER= pnpm verify` | Passed: typecheck, unit tests, Rust tests, static production build |
| Svelte/TypeScript diagnostics | 0 errors, 0 warnings |
| Vitest | 86 tests passed across 5 suites |
| Rust unit tests | 6 passed |
| `CI=1 pnpm test:e2e` | 10 passed: 5 Chromium and 5 Firefox, 3.0 minutes |
| Pinned local assets | All 21 SHA256 hashes verified; complete asset set approximately 217 MiB |

Browser acceptance exercises actual Rust/Pdfium PDF extraction and quantized E5
embeddings, DE/EN retrieval, exact source highlights, persistence and notebook
isolation. It also covers source rejection, unsafe source text, generation
coverage, source revisions, cancellation, deletion and recovery after a failed
model download. A cold model load makes one ONNX request; reload reuses the cache.
Desktop, source, Studio and mobile screenshots were visually inspected.

The Mistral and OpenRouter requests were intercepted with fixture responses and
dummy keys. Tests verify endpoint selection, request bodies, privacy flags,
schema/citation validation, all three generators, rate-limit handling and
discarding late responses. They do not verify live provider entitlements,
regional model availability, billing or actual generated answer quality.

The v0.0.1 Study Guide regression reproduces the former failure with thirteen
valid transmitted citations. Request and local validation now share size bounds;
the citation count follows the transmitted context instead of a fixed limit of
twelve. The tests also reject empty or oversized answers with payload-free
diagnostics. The exact constraint violated by the user's original live response
was not inspected, so live retry is still required.

The browser regression exercises both API adapters with a thirteen-reference
guide, verifies every linked span and restores the artifact after reload. The
data-wipe assertion checks ResearchBench-owned records and caches while
preserving an independent session-storage entry. API responses remain mocked.

The Firefox regression originally stalled during model downloading. With the
normal binary download path, its cold real-pipeline test completed in 12.4 seconds.
This is a local measurement, not a performance guarantee for other hardware or
network conditions.

## Remaining manual submission gates

- Enter a funded, user-owned key and test real grounded chat and each generator.
- Publish the complete static build to the chosen HTTPS host and check its MIME
  types, SPA fallback, import speed and API access from the deployed origin.
- Record the demo in at most ten minutes and provide the repository, live demo
  and video links in the application reply.

WebLLM/WebGPU generation remains an optional bonus and is not implemented.
