# NotebookLM reference feature mapping

Comparison date: **2026-10-15**. ResearchBench implementation baseline:
`45019c749b7b886cedd4edcf2ea6c3dd1cf809ff`.
This is a bounded capability mapping, not a claim of full parity or equivalent
output quality. Google feature availability can differ by account, plan and device.

The assignment names NotebookLM. The official help pages checked for this
comparison currently use the name **Gemini Notebook**; the brief retains its
original wording. Reference capabilities below come from Google's public
documentation. No authenticated reference account was exercised for this mapping.

Status describes ResearchBench at the stated revision:

- **Implemented:** the named bounded capability exists in code and has regression
  coverage; this does not assert every reference option or equal quality.
- **Partially implemented:** a narrower version of the reference capability exists.
- **Excluded:** outside the chosen scope at this baseline.
- **Unverified:** evidence is insufficient for the stated comparison or guarantee.

## Capability mapping

Reference links: [notebooks and Studio][notebooks], [source types and discovery][sources],
[Chat and citations][chat], [Audio Overviews][audio]. The evidence column links
ResearchBench code and representative tests; tests using intercepted provider
responses do not establish live API or voice quality.

| Reference capability | ResearchBench status and boundary | Implementation / verification evidence |
| --- | --- | --- |
| Project notebooks with sources ([reference][notebooks]) | Implemented: create, rename, delete and reopen local notebooks; up to 50 sources subject to other limits. | [Controller](../../src/lib/controller.ts), [storage](../../src/lib/storage.ts), [capacity regressions](../../tests/e2e/source-capacity.spec.ts) |
| Document and connected-source import ([reference][sources]) | Partially implemented: PDF/MD/TXT file chooser and drag/drop. No direct web, YouTube, Drive/Workspace, image, office-file or audio ingestion. | [Pipeline Worker](../../src/lib/pipeline.worker.ts), [Rust parsing](../../crates/research-core/src/lib.rs), [import tests](../../tests/unit/import-capacity.test.ts) |
| Source questions and clickable citations ([reference][chat]) | Implemented: retrieval-backed Chat with source-ID validation and text-span navigation. References do not prove semantic support; original PDF layout and image citations are not reproduced. | [Providers](../../src/lib/providers.ts), [source viewer](../../src/lib/components/SourceViewer.svelte), [browser workflow](../../tests/e2e/researchbench.spec.ts) |
| Selecting individual sources for Chat ([reference][chat]) | Excluded: retrieval searches the active notebook; there is no include/exclude source checklist. Source deletion changes notebook content. | [Chat retrieval](../../src/lib/controller.ts), [source panel](../../src/routes/+page.svelte) |
| Reports, including FAQs and study guides ([reference][notebooks]) | Partially implemented: Summary, FAQ and Study Guide presets with cited sections and bounded coverage. No arbitrary report builder or Docs/Sheets export. Generation is user-triggered. | [Schemas](../../src/lib/schema.ts), [context selection](../../src/lib/context.ts), [provider tests](../../tests/unit/providers.test.ts) |
| Host-led audio discussion, playback and download ([reference][audio]) | Partially implemented: two-host podcast, contribution-level transcript references, local MP3, player and download; EN default/DE experimental. No interactive join mode or alternative reference audio formats. | [Podcast adapter](../../src/lib/podcast-providers.ts), [player](../../src/lib/components/PodcastView.svelte), [podcast E2E](../../tests/e2e/podcast.spec.ts), [timing E2E](../../tests/e2e/podcast-timeline.spec.ts) |
| Notes and saved Chat-to-note workflows ([reference][notebooks]) | Excluded: persisted Chat and generated artifacts exist, but no independent editable noteboard. | [Stored types](../../src/lib/types.ts), [storage](../../src/lib/storage.ts) |
| Mind maps, video, flashcards/quizzes, slides, infographics and data tables ([reference][notebooks]) | Excluded: the Studio output set is Summary, FAQ, Study Guide and Podcast. A prose study guide is not an interactive quiz. | [Studio types](../../src/lib/types.ts), [Studio UI](../../src/routes/+page.svelte) |
| Source labels/categories ([reference][sources]) | Excluded: source list and capacity feedback, without automatic topic grouping or labels. | [Source UI](../../src/routes/+page.svelte) |
| Web/Drive research and source discovery ([reference][sources]) | Excluded: user-supplied files only; no browsing tools or research agent. | [Import controller](../../src/lib/controller.ts), [provider request](../../src/lib/providers.ts) |
| Shared notebooks, public links and usage analytics ([reference][notebooks]) | Excluded: data stays in the current browser profile; no collaboration backend, account synchronization or analytics. MP3 download is a local file export. | [Storage](../../src/lib/storage.ts), [static SPA configuration](../../src/routes/+layout.ts) |
| Source-only factual correctness as described for Chat ([reference][chat]) | Unverified as a guarantee: ResearchBench checks schema, citation membership and lexical heuristics, not semantic entailment. Unsupported prose can pass; supported wording can be removed. No equivalent correctness claim is made for either product by this comparison. | [Support gate](../../src/lib/support-gate.ts), [current residuals](../security/README.md), [gate tests](../../tests/unit/support-gate.test.ts) |
| Equivalent live output, voice quality and account-dependent behavior | Unverified: no side-by-side live benchmark was performed. Mocked provider tests and structural validity cannot establish these outcomes. | [Verification boundaries](../verification.md#manual-acceptance-and-limits), [audit coverage](../security/README.md) |

## ResearchBench-specific choices

Local Rust/WASM parsing, local multilingual embeddings, IndexedDB persistence,
BYOK with Mistral/OpenRouter, EN/DE interface text and System/Light/Dark appearance
are project choices. They are not requirements from the brief or evidence of
reference-product superiority. Implementation is in the
[pipeline](../../src/lib/pipeline.worker.ts), [storage](../../src/lib/storage.ts),
[i18n](../../src/lib/i18n/index.ts) and [theme](../../src/lib/theme.ts) modules;
[appearance workflows](../../tests/e2e/appearance-workflows.spec.ts) and
[language tests](../../tests/e2e/i18n.spec.ts) cover selected interactions.

See [scope and limits](scope.md) for context budgets, extraction completeness,
offline boundaries and provider dependencies. The
[verification guide](../verification.md) distinguishes automated coverage from
manual/live acceptance. Neither the table nor the test suites certify full
accessibility, complete security or semantic grounding.

[notebooks]: https://support.google.com/gemininotebook/answer/16206563?hl=en
[sources]: https://support.google.com/gemininotebook/answer/16215270?hl=en
[chat]: https://support.google.com/gemininotebook/answer/16179559?hl=en
[audio]: https://support.google.com/gemininotebook/answer/16212820
