# Changelog

## 0.0.1 — 2026-10-12

First version of ResearchBench: a static browser research workbench with a
Rust/WASM core, local multilingual retrieval and user-owned generation keys.

- PDF, Markdown and TXT import, local E5 embeddings, Rust cosine retrieval and
  atomic IndexedDB persistence.
- Notebook management, grounded chat, exact source-span navigation, summaries,
  FAQs and study guides.
- Direct Mistral EU inference by default and OpenRouter as an explicit alternative.
- Cancellation, source-revision checks, data deletion and responsive German UI.
- Shared generation/validation bounds and context-dependent citation counts:
  study guides can cite more than twelve transmitted passages per section.
- Unit, Rust and production browser regression coverage, pinned self-hosted
  assets, privacy documentation and a Loom outline.

Live provider acceptance and deployment remain separate manual gates. The
optional WebLLM mode is not included.
