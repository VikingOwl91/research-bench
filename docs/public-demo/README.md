# Public NIST demo sources

Import only `nist-ai-rmf-core-excerpt.pdf` and `nist-ai-rmf-launch.txt` into the
acceptance notebook. These are authentic public NIST materials, separate from
ResearchBench's fictional CC0 test fixtures. The reference metadata is not an
additional source to import.

The PDF contains unchanged physical pages 25–26 (zero-based 24–25) of the 48-page
[NIST AI RMF 1.0](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf), published
January 2023. They retain printed page numbers 20–21 and include the Core overview,
Figure 5 and the beginning of GOVERN. In the app they are pages 1–2. This is a
clearly identified excerpt, not the complete framework. Both rendered pages
were compared with the original and are pixel-identical at 1000px.

The TXT includes the title, subtitle, date and all 15 main paragraphs of the
[January 26, 2023 NIST launch article](https://www.nist.gov/news-events/news/2023/01/nist-risk-management-framework-aims-improve-trustworthiness-artificial).
Whitespace is normalized. Navigation, the image, a duplicate quote callout and
media contacts are omitted; substantive main paragraphs are retained. Claims
about future activities remain statements made at publication, not proof that
those activities have since happened.

Attribution: National Institute of Standards and Technology (NIST). Retrieved
October 13, 2026. The [NIST reuse policy](https://www.nist.gov/copyrights-disclaimers)
permits copying/distribution of public information except material marked as
copyrighted and requests attribution. No separately copyrighted material is
marked on these selected pages or in the main article. This selection is not
relicensed under AGPL or CC0; no NIST endorsement is implied.

[reference.json](reference.json) records original/download hashes, excerpt and
TXT hashes, original/app page mapping and source-grounded questions. The local
Poppler PDF text plus TXT estimate is below 24,000 characters; the release's
real Rust/Pdfium import must separately record actual canonical characters and
coverage. The estimate is not a claim that a runtime acceptance gate passed.

Use the TXT-only consultation question, the cross-source function question and
the absent incident-reduction question for chat acceptance. Check approximate
qualifiers (“about 400”, “more than 240”), voluntary use, iterative application
and publication dates. All generated podcast assertions still require checking
against the sources; valid citation IDs alone do not prove their meaning.
