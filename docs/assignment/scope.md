# Implemented scope and boundaries

Baseline: **2026-10-15**, revision
`45019c749b7b886cedd4edcf2ea6c3dd1cf809ff`.
See the [brief and interpretation](README.md) for the distinction between
assignment requirements and project choices.

## Implemented workflow

ResearchBench provides local notebooks containing PDF, Markdown and UTF-8 text
files. Imports create canonical page text, overlapping chunks and local
multilingual embeddings. Users can search without an API key, ask questions,
open cited text spans, and generate a summary, FAQ or study guide. Podcasts add
a two-host script, contribution-level cited transcript, playback and MP3
download. Sources, indices, chat and generated artifacts persist in IndexedDB.

The implementation is a statically built SvelteKit SPA. Rust compiled to WASM
handles parsing/chunking and cosine retrieval; Pdfium and embedding inference
run in a Worker. Mistral direct is the default generation connection and
OpenRouter is an explicit alternative. The app has no application backend,
account system or automatic cross-provider fallback. See the existing
[architecture](../../README.md#architecture),
[contracts](../../src/lib/contracts.md) and
[feature evidence table](feature-parity.md) for the implementation paths.

## Limits that shape the scope

The authoritative values are in [constants.ts](../../src/lib/constants.ts).
Character budgets count Unicode scalars; source highlights use UTF-16 offsets.

| Boundary | Current behavior |
| --- | --- |
| Sources | At most 50 stored sources per notebook; chooser/drop feedback and transactional capacity checks cover concurrent imports. |
| Original file bytes | 10 MiB per file at the application import boundary. The internal storage API does not independently recheck Blob bytes; see the [documented reachability gap](../source-capacity-phase-a.md#pre-existing-storage-byte-limit-gap). |
| Notebook text and index | At most 500,000 canonical characters and 1,000 chunks in aggregate; 50 sources is not a total-size or performance guarantee. Browser storage quota can fail earlier. |
| Chat evidence | Up to six retrieved chunks, not all stored sources. Bounded history can include up to four conversation pairs from the current source revision. |
| Studio evidence | Complete canonical text within 24,000 characters; otherwise bounded, non-overlapping passages spread across sources. Coverage is reported. Fifty stored sources need not all participate. |
| PDF interpretation | Extracted text with page anchors, not an original-layout PDF viewer. Image-only scans need OCR, which is not implemented. Tables, diagrams, reading order and missing text can affect evidence completeness. |
| PDF visibility | Partial render-mode/paint annotations, not proof of what a human sees. Clipping, overlays, unknown paint properties and alignment fallback remain limitations. Extracted text is preserved. |
| Answer integrity | Schema, citation membership, span navigation and selected numeric/quotation heuristics are checked. Semantic claim entailment, external fact-checking and exhaustive prompt-injection prevention are not provided. Historical saved answers are not retrospectively certified. |
| Podcast language | English default; German explicitly experimental with the current British voice presets. Timestamps identify contributions, not words. Voice quality and current API access require real listening/account checks. |

The [security index](../security/README.md) documents both missed unsupported
claims and possible false positives. A source-context export is a saved citation
projection, not an authenticated capture of the transmitted request; recognized
instruction-like sentences can be sanitized before transmission.
The Studio budget bounds selected source text, not the complete request with
prompts, schema and other fields.

## Offline and provider boundaries

Import, embedding and search are local once the required assets are available.
An already loaded app can use local data and saved audio without generation
requests. Initial setup and uncached model/runtime downloads require a network
connection. There is no service-worker offline installation or guaranteed
offline cold start; cache retention and IndexedDB durability depend on the browser.

New Chat and Studio text require the selected provider and a usable user key.
New podcast audio also requires that provider's speech service. Selected source
text, the question/instructions and bounded chat history are sent for text
generation; script contributions are sent for speech. A small notebook can fit
entirely in the selected context. Keys are kept in sessionStorage and sent in
authorization headers. Session restoration can retain them; origin scripts can
access them. The [privacy documentation](../../README.md#privacy-and-gdpr-precise-boundaries)
describes the provider and hosting boundaries without claiming universal GDPR
compliance or fully offline generation.

## Deliberate exclusions at this baseline

The current scope excludes cloud accounts, cross-device synchronization,
collaborative/public notebook sharing, remote source discovery, direct website
or YouTube ingestion, Google Workspace integrations, audio transcription, OCR,
and additional visual/interactive Studio formats. Audio is generated in advance;
users cannot join the hosts with live voice questions. There is no local LLM or
WebGPU generation mode. These are product boundaries, not requirements left
unfulfilled by the open brief or commitments to future implementation.

Manual transcripts can be imported as text files; that does not implement a
YouTube connector. Downloading an MP3 does not implement cloud sharing. Responsive
web layouts do not imply native mobile applications. The
[feature mapping](feature-parity.md) records these distinctions explicitly.

## Scope evolution supported by repository history

This chronology records shipped code, without reconstructing unrecorded plans:

| Evidence | Scope present or added |
| --- | --- |
| `9da19a3` (2026-10-12), initial v0.0.1 commit | Notebook/source management, local pipeline, Chat and summary/FAQ/study generators. These form the earliest committed implementation, not a complete historical planning record. |
| `d699cc6` (2026-10-13) | Podcasts, EN/DE interface localization and browser-only release tooling were added after that initial implementation. |
| `8356e89` (2026-10-13) | Source-reference wording and prototype limitations were clarified. |
| `2e999ff` and `a61090f` (2026-10-14) | Appearance/accessibility work and enlarged-text wrapping correction. |
| PR #3 merge `a77310d` (2026-10-15) | Reviewed red-team remediations, including lexical support checks and partial PDF provenance; not semantic verification. |
| PR #4 merge `8836b09` (2026-10-15) | Capacity expanded from 10 to 50 sources, import accounting and overlapping-refresh fencing; [measurements and limits](../source-capacity-phase-a.md). |

The original brief did not mandate these extensions. Test and acceptance
instructions are maintained in [verification.md](../verification.md); known
prototype limitations remain relevant even when those tests pass.
