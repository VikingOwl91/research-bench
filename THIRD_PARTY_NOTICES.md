# Third-party assets

ResearchBench's own application code is MIT-licensed. Bundled dependencies and
model/runtime assets retain their upstream licenses and notices.

`scripts/assets-manifest.json` records exact revisions, SHA256 digests, download
URLs, sizes and license sources. `pnpm assets:prepare` ships the corresponding
notices with the statically deployed assets. The model namespace digest is
derived from its pinned file inventory; the release manifest identifies the
exact deployed notice paths:

| Component | License | Shipped notice |
| --- | --- | --- |
| multilingual-e5-small (intfloat, ONNX conversion by Xenova) | MIT | `/models/<asset-set-sha256>/multilingual-e5-small/LICENSE.txt`, `README.md` |
| Pdfium | BSD-3-Clause and bundled third-party notices | `/pdfium/LICENSE.txt` |
| pdfium-lib distribution | MIT | `/pdfium/pdfium-lib-LICENSE.md` |
| ONNX Runtime Web | MIT and bundled third-party notices | `/runtime/LICENSE.txt`, `/runtime/ThirdPartyNotices.txt` |
| @breezystack/lamejs 1.2.7, based on LAME | LGPL-3.0 | `/runtime/lamejs-NOTICE.txt`, `/runtime/lamejs-README.md`, `/runtime/LGPL-3.0.txt`, `/runtime/GPL-3.0.txt` |

The MP3 encoder is shipped unmodified as a separate, replaceable JavaScript
module at `/runtime/lamejs.js`; the application Worker imports it at runtime.
Its package version, exact bytes and hashes are pinned in the asset manifest.
The published npm package's `gitHead` pins its matching source to
`1fb0ef5fa177413107e2e107d054a9b994e3f79c`. Full source and build configuration are
shipped at `/runtime/lamejs-source-1.2.7.tar.gz`; rebuilding reproduced the deployed
module byte for byte. See [source and rebuild instructions](static/notices/lamejs-source.md)
(deployed at `/notices/lamejs-source.md`) and
[the pinned upstream source](https://github.com/gideonstele/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c).
Recipients may replace that module with a compatible build; it is not folded
into the application's MIT-licensed bundle. LGPL/GPL texts and the upstream
source, rebuild instructions and upstream README accompany the deployed encoder.

Rust and JavaScript package licenses are recorded in their manifests and lock
files. Review those licenses when redistributing a modified application.

All documents under `tests/fixtures` were authored specifically for this project
and are distributed under ResearchBench's MIT license. They contain fictional
research scenarios, not user documents.
