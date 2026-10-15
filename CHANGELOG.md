# Changelog

## 0.1.0 — candidate (unreleased)

- Store up to 50 sources per notebook with localized capacity and batch-import feedback;
  existing per-file, extracted-text, chunk and generation-context limits remain.
- Preserve atomic capacity enforcement across tabs and fence overlapping source refreshes.
- Add bounded source-instruction filtering and numeric/quotation support heuristics,
  including resumed podcast scripts before speech. These do not verify semantic support.
- Improve PDF rendering-property provenance, bounded source-viewer segmentation,
  progress-aware indexing timeouts and Firefox audio/cache regression coverage.
- Pin CI actions, extend timeout headroom and reconcile public setup, privacy, security,
  licensing and source-rebuild documentation. Include the existing axe-core notices.

Prototype limitations remain: unsupported claims can survive and supported wording can
be removed; PDF visibility/extraction is incomplete; browser storage/performance varies.
Not all stored sources participate in every generated answer. The internal storage API
byte-limit hardening gap is documented. No production-security, accessibility-conformance
or cross-toolchain binary-reproducibility certification is claimed.

This entry describes a local release candidate, not a published tag or deployment.

## 0.0.4 — 2026-10-14

- System, Light and Dark appearance with persisted preferences and switching without reload.
- Consistent semantic colors, readable disclosures, native controls and visible keyboard focus.
- Responsive Sources/Research/Studio panes, narrow-screen reflow and safe-area styling.
- Named dialogs and landmarks, keyboard focus management and accessible Podcast seek labels.
- Chromium/Firefox appearance, text-resizing and accessibility regression coverage.

Generation behavior and citation validation are unchanged. Source references do not
provide automatic semantic verification; German podcast voices remain experimental.

## 0.0.3 — 2026-10-13

- AGPL-3.0-or-later for new application code; historical MIT releases remain unchanged.
- Commit-bound source downloads and license offers on the live demo.
- Public NIST demo sources and a prepared OBS/YouTube demonstration outline.
- Native browser acceptance for storage, offline and provider failure states.

## 0.0.2 — 2026-10-13

Cited podcasts, English-first localization and hardened static releases.

- Two-host podcasts, local MP3 export and contribution-level transcript navigation.
- English UI and podcasts by default; German UI and experimental German voices.
- Restrictive document and Worker CSPs, framing protection and HTTPS security headers.
- Clean-commit-bound static release artifacts and public hosting acceptance checks.
- Content-addressed embedding assets and explicit browser-cache regression coverage.
- API-key session-restore disclosures and visible Unicode direction controls in filenames.
- Paused transcript seek correction, speaker playback rates and native audio regressions.
- Network-free reuse of prepared assets and bundled pinned license texts.

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
