# Third-party assets

ResearchBench's own application code is MIT-licensed. Bundled dependencies and
model/runtime assets retain their upstream licenses and notices.

`scripts/assets-manifest.json` records exact revisions, SHA256 digests, download
URLs, sizes and license sources. `pnpm assets:prepare` ships the corresponding
notices with the statically deployed assets:

| Component | License | Shipped notice |
| --- | --- | --- |
| multilingual-e5-small (intfloat, ONNX conversion by Xenova) | MIT | `/models/multilingual-e5-small/LICENSE.txt`, `README.md` |
| Pdfium | BSD-3-Clause and bundled third-party notices | `/pdfium/LICENSE.txt` |
| pdfium-lib distribution | MIT | `/pdfium/pdfium-lib-LICENSE.md` |
| ONNX Runtime Web | MIT and bundled third-party notices | `/runtime/LICENSE.txt`, `/runtime/ThirdPartyNotices.txt` |

Rust and JavaScript package licenses are recorded in their manifests and lock
files. Review those licenses when redistributing a modified application.

All documents under `tests/fixtures` were authored specifically for this project
and are distributed under ResearchBench's MIT license. They contain fictional
research scenarios, not user documents.
