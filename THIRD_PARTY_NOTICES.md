# Third-party assets

ResearchBench's own application code is AGPL-3.0-or-later licensed from v0.0.3.
Earlier MIT releases retain their original permissions. Bundled dependencies and
model/runtime assets retain their upstream licenses and notices.

`scripts/assets-manifest.json` records exact revisions, SHA256 digests, download
URLs, sizes and license sources. `pnpm assets:prepare` ships the corresponding
notices with the statically deployed assets. The exact pinned LGPL/GPL license
texts are also committed so builds do not depend on access to the GNU website. The model namespace digest is
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
into the application's AGPL-licensed bundle. LGPL/GPL texts and the upstream
source, rebuild instructions and upstream README accompany the deployed encoder.

## JavaScript and Rust packages

The deployed `/notices/npm-licenses.txt` and `/notices/rust-licenses.txt` preserve
upstream permission, copyright and notice texts. The accompanying JSON files
record exact versions, license declarations and SHA256 hashes of the collected
notice files. This inventory includes all 119 installed npm package versions and all 58
third-party Cargo.lock entries, including build/test, Node-only and non-WASM
platform dependencies. It is intentionally broader than the browser bundle.
The package lockfiles remain the dependency source/identity contracts.

The runtime JavaScript uses Svelte/SvelteKit, idb (ISC), lucide-svelte (ISC), zod
(MIT), Transformers.js and its tokenizers (Apache-2.0), Jinja (MIT), ONNX Runtime
Web (MIT) and their upstream transitive code. The Rust core uses the MIT option
where a crate offers MIT or Apache-2.0; unicode-ident additionally requires its
Unicode-3.0 notice, which is included. Do not remove upstream notices during
bundling or redistribute dependencies as if their original licenses had changed.
Apache-2.0 notices and attribution remain available with the distribution.

Transformers.js selects its browser export for the deployed Worker. Its Node
sharp/libvips (LGPL-3.0-or-later) and onnxruntime-node dependencies are not shipped
in the static application. Lightning CSS (MPL-2.0) is a build tool; axe-core (MPL-2.0) is used only for
automated accessibility testing. Neither is
shipped as a native binary or modified source in the application. Rebuilding
downloads those tools through the pinned lockfile. Their installation does not
license the application or waive obligations if someone later redistributes
those binaries. The only LGPL module intentionally distributed here is the
separately replaceable MP3 encoder, with matching source as described above.

Some npm distributions omit a separate full license file. Their original
package-manifest license/author declaration is preserved in the inventory; for
MIT/ISC declarations the matching standard SPDX permission terms are also
provided without inventing a copyright year or holder. ONNX package permission
and third-party texts are covered by the shipped Microsoft runtime notices.
These records describe the pinned packages; modifications or newly bundled
dependencies require another notice and compatibility review.

All fixture texts and PDFs under `tests/fixtures` are original fictional project
content dedicated to the public domain under CC0-1.0, as declared in their own
README. Their generator and application code keep the project code license.
The authentic public NIST inputs under `docs/public-demo` retain NIST's public
information reuse terms and attribution; they are not AGPL code or CC0 fixtures.
See [the source attribution](docs/public-demo/README.md).
