# Integration contracts

All spans are half-open UTF-16 offsets into the immutable canonical page text.
Source pages use 1-based numbering; TXT/MD have one logical page. No original-PDF overlays.

Rust WASM exports:
- initialize_pdfium_render(pdfiumModule, rustModule, false) -> boolean (crate export).
- parse_pdf(bytes: Uint8Array) -> PageText[] via serde-wasm-bindgen.
- parse_text(bytes: Uint8Array) -> PageText[]. UTF-8 only.
- chunk_pages(pages: PageText[], size: number, overlap: number) -> {page,start,end,text}[]; Unicode scalar window size, UTF-16 offsets.
- cosine_search(matrix: Float32Array, query: Float32Array, k: number) -> {index,score}[]; rejects invalid dimensions/nonfinite/zero query.

Worker imports generated ESM bindings at `./wasm/research_core.js`, loads pinned Pdfium glue/wasm from `/pdfium/`, and local embeddings from `/models/<asset-set-sha256>/multilingual-e5-small/`.

App controller at `#lib/controller.ts` exports `ResearchBenchController` with `subscribe(callback)` and async methods:
`initialize()`, `createNotebook(name)`, `renameNotebook(name)`, `selectNotebook(id)`, `deleteNotebook(id)`, `importFiles(files: File[])`, `deleteSource(id)`, `search(query)`, `ask(question)`, `generate(kind)`, `clearAll()`, plus `setProvider(provider)`, `setKey(key)`, `cancel()`, `clearError()`.
Controller publishes `AppSnapshot` and throws handled errors only through snapshot.error.
Frontend owns source selection display; citation lookup uses each message/artifact's frozen citations.
`displaySourceName(name)` replaces Bidi controls with visible codepoint markers only at display boundaries; filename spans use `<bdi>` isolation. Raw source/citation names, document bytes and source offsets are unchanged, including persisted legacy citations.
Controller exports constants MODEL_NAMES and PROVIDER_NAMES; components may import these from `#lib/constants.ts`.
