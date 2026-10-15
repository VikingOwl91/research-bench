# Integration contracts

This file describes current interfaces; implementation and type definitions are
authoritative. It does not change the model's structured-answer contract.

## Canonical text and WASM

All spans are half-open UTF-16 offsets into immutable canonical page text.
Source pages are 1-based; TXT/MD use one logical page. The viewer renders
extracted text with page anchors, without original-PDF overlays.

Rust/WASM exports:

- `initialize_pdfium_render(pdfiumModule, rustModule, false)` → boolean (crate export).
- `parse_pdf(bytes: Uint8Array)` → `PageText[]` via serde-wasm-bindgen.
- `parse_text(bytes: Uint8Array)` → `PageText[]`; strict UTF-8.
- `chunk_pages(pages, size, overlap)` → `{page,start,end,text}[]`; window sizes
  count Unicode scalars, offsets count UTF-16 units.
- `cosine_search(matrix: Float32Array, query: Float32Array, k)` → `{index,score}[]`;
  invalid dimensions, nonfinite values and zero queries are rejected.

`PageText.hiddenSpans` optionally records `invisible`/`white` rendering
properties in canonical UTF-16 coordinates. These are partial annotations,
not proof of actual visibility. The viewer caps decoration at 1,000 incoming
spans, preserving canonical text and citation highlighting when markers are omitted.

The pipeline Worker imports generated ESM bindings at `./wasm/research_core.js`,
pinned Pdfium glue/WASM under `/pdfium/`, and local embeddings under
`/models/<asset-set-sha256>/multilingual-e5-small/`. Remote model loading is disabled.
Cancellation terminates the Worker. Progress resets a five-minute inactivity
watchdog; this does not enforce a total processing-time budget.

## Controller, storage and capacity

`ResearchBenchController` in `#lib/controller.ts` publishes `AppSnapshot` through
`subscribe(callback)`. UI operations include notebook lifecycle, `importFiles`,
`refreshSources`, `deleteSource`, `search`, `ask`, `generate`, podcast
creation/resume/voice-test/audio access/deletion, `setProvider`, `setKey`, `cancel`,
`clearError` and `clearAll`. Handled operation errors are reported through the
snapshot. Use `types.ts` and public method signatures for exact arguments.

`LIMITS` in `constants.ts` defines 50 sources/notebook, 10 MiB/file, 500,000
canonical characters, 1,000 chunks and 24,000 context characters. Import preflight
checks actual file bytes and persisted capacity/revision before reading/indexing.
Imports are sequential and stop at first failure/capacity, with per-file transient
accounting. Committed sources survive later cancellation. Source/chunk/vector
writes are atomic and revision-fenced. The storage API does not independently
validate original file bytes; the shipped controller is its only production
source-ingestion caller. IndexedDB remains schema version 2.

Refresh requests share a monotonically increasing publication fence, plus
existing notebook/view/job guards. Stale refresh completions cannot replace newer
counts, revisions or import availability. Reads are not globally serialized.

## Generation and provenance

Chat sends the top six retrieval results; Studio uses complete canonical text
within budget, otherwise a bounded spread of passages. Fifty stored sources
need not all participate. Frozen citations belong to each saved answer/artifact;
source viewing rechecks exact spans before highlighting.

Provider adapters validate the existing JSON schema and citation-ID membership.
`sanitizeForModel` filters recognized instruction-like source sentences before
transmission. `applySupportGate` and `applyPodcastSupportGate` compare selected
numbers/paired quotations with sanitized excerpts before new output is returned
for display/persistence or speech. The gates do not establish claim entailment.
Titles, arbitrary prose and other residuals are documented in the security index.
Paused podcast resume revalidates frozen evidence inside the fenced claim
transaction before new TTS. Historical ready artifacts are not rewritten.

Source-context exports contain the saved citation projection, not an authenticated
wire capture. They omit answer identity and headers; source sanitization can make
transmitted text differ from the original frozen citation text.

## Display boundaries

The UI owns source selection. `displaySourceName(name)` replaces bidi controls
with visible codepoint markers only for display; filename spans use `<bdi>`.
Raw names, bytes and stored citation offsets remain unchanged, including legacy
citations. Provider/model constants are imported from `#lib/constants.ts`;
localized display labels belong to the i18n layer.
