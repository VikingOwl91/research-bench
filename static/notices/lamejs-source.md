# MP3 encoder source and rebuilding

ResearchBench loads the unmodified `@breezystack/lamejs` 1.2.7 encoder as a
separate module at `/runtime/lamejs.js`. The source retains its upstream LGPL
license. This document describes the pinned source, not ResearchBench's own code.

- Published npm version: `@breezystack/lamejs@1.2.7`
- Published npm `gitHead`: `1fb0ef5fa177413107e2e107d054a9b994e3f79c`
- [Full matching source archive](../runtime/lamejs-source-1.2.7.tar.gz), including
  editable `src/js`, `vite.config.ts`, `pnpm-lock.yaml`, README and license
- [Pinned upstream tree](https://github.com/gideonstele/lamejs/tree/1fb0ef5fa177413107e2e107d054a9b994e3f79c)
- Archive SHA256: `af8f08f0ff9a13777f2ffff737b48e40019b53a4b21db270dd62e829574e2b83`
- Deployed module SHA256: `1c5f944911ccf2f6e29ab36c2e568363210ab16f50c0d76077060f40ecf91d28`

To rebuild in a separate directory, use Node.js 22 or later and pnpm 8.15.9
(the upstream source uses a version-6 pnpm lockfile):

```sh
tar -xzf lamejs-source-1.2.7.tar.gz
cd lamejs-1fb0ef5fa177413107e2e107d054a9b994e3f79c
npm exec --yes --package=pnpm@8.15.9 -- pnpm install --frozen-lockfile --ignore-scripts
node node_modules/vite/bin/vite.js build
sha256sum dist/lamejs.js
```

On 12 October 2026 this build reproduced the deployed JavaScript module byte for
byte using the source's locked Vite 4.4.11 dependency. `pnpm install` needs public
registry access. The lockfile and configuration are included so dependencies and
build options can be inspected before execution.

Recipients can modify and rebuild the encoder and replace `/runtime/lamejs.js`
with a compatible module exporting `Mp3Encoder`. It is imported dynamically by
the audio Worker, without a hash check that prevents replacement. ResearchBench's
asset preparation verifies upstream bytes during the standard build; users who
replace the encoder should deliberately update their own asset manifest/build.

The [upstream notice](../runtime/lamejs-NOTICE.txt),
[LGPL 3 text](../runtime/LGPL-3.0.txt) and [GPL 3 text](../runtime/GPL-3.0.txt)
are distributed alongside the module. See also [LAME](https://lame.sourceforge.net/).
