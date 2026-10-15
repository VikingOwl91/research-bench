# v0.1.0 candidate and release checklist

Status: **local preparation, not a published release**. The feature set is frozen.
Starting baseline: `8836b098984656ef64cac13ddd228e2766f0b6bd`.
Historical tags and signed commits remain intact. The repository stays private.

## Candidate scope and release notes

ResearchBench is a local-first browser prototype with Rust/WASM parsing,
multilingual local embeddings, notebook search, source-reference chat, summaries,
FAQ, study guides and two-host podcasts. Mistral EU is the default BYOK connection;
OpenRouter is an explicit alternative. English is the default interface/podcast
language; German speech remains experimental. System/Light/Dark appearance and
responsive EN/DE controls are included.

Since the v0.0.4 milestone:

- Notebook capacity increased from 10 to 50 sources, with localized remaining
  capacity, per-file import outcomes and explicit stale-tab refresh.
- Transactional source/revision enforcement and overlapping-refresh fencing
  preserve committed imports and prevent stale counts from replacing newer reads.
- Reviewed generation-integrity remediations add instruction-pattern filtering,
  numeric/quotation matching, pre-TTS resume checks, partial PDF rendering-property
  annotations and bounded source-viewer work. These mitigate tested cases without
  semantic proof.
- Public-facing docs, security reporting prerequisites, version metadata and
  release/supply-chain checks are prepared for review. Exact cleanup verification
  results belong to the final candidate evidence, not this prospective list.

Known limitations: 50 sources remain subject to 10 MiB/file, 500,000 extracted
characters, 1,000 chunks and 24,000 context characters. Generation need not use
all sources. Grounding checks are lexical heuristics with false positives and
false negatives. PDF extraction/visibility is incomplete; browser quotas, cache
retention, audio availability and performance vary. The internal storage API
original-byte check is a documented defense-in-depth gap; the shipped import
controller enforces the byte limit. See [README](../README.md),
[security limitations](security/README.md) and [Phase A measurements](source-capacity-phase-a.md).
Future work may improve those limitations; this release makes no delivery promise.

## Local gates

Run from the exact clean signed candidate with the recorded toolchain:
Node.js 26.11.1, pnpm 11.28.5, Rust 1.98.1, Python 3, Git/rustup and
repository-pinned assets. Python is used to extract the pinned Pdfium ZIP.

```sh
pnpm install --frozen-lockfile
pnpm assets:prepare
node scripts/prepare-assets.mjs --verify
pnpm wasm:build
pnpm verify
pnpm exec playwright install chromium firefox
pnpm source:prepare --expected-head "$(git rev-parse HEAD)"
pnpm test:e2e
pnpm test:security
pnpm release:prepare build .cache/releases --require-clean --expected-head "$(git rev-parse HEAD)"
pnpm release:verify <release-directory> --require-clean --expected-head "$(git rev-parse HEAD)"
```

Browser tests need functional native audio; unavailable audio is a failure, not
permission to skip cases. CI provisions its own isolated null sink. Follow the
established workflow without weakening assertions or hiding timeout pressure.
Record observed counts, tool versions, elapsed time and direct command exit codes.
Production builds clear `build/`; regenerate the matching source offer afterward.
`source:prepare` and strict release preparation require a clean committed tree.

Check dependency advisories, lockfile integrity, immutable action identities,
asset hashes and all redistribution obligations. Read historical audit reports
alongside their later remediation ledger. Scan tracked files, reachable history
and retained remote logs/artifacts with redacted results; a current-tree scan
does not establish historical disclosure readiness.

## Fresh-clone and source verification

Build the same commit in a separate clean clone with a fresh dependency/Rust
build environment. Do not copy application output as proof of a rebuild. Downloaded
pinned public assets may be reused only when their hashes are independently checked.
Record any cache reuse or unavailable environment separately.

Compare complete build manifests and actual file contents. A differing
`.tar.gz` hash alone cannot distinguish changed source from gzip/runtime variance.
For each source offer compare:

1. Compressed archive SHA-256 and the recorded compression/runtime versions.
2. Decompressed tar bytes and archive member inventory.
3. Every member's path, file mode, size and SHA-256, including provenance and
   rebuild instructions; check the recorded Git tree and blob identities.
4. The rest of the complete static build manifest, with every difference classified.

The source checker validates inventory, modes, Git blobs/tree, license and expected
commit. Rebuilding an extracted source archive creates a new local Git commit/build
identity; it does not reproduce the original identity or promise identical binaries.
Do not call a source-equivalent build byte-reproducible without measurements.
Do not silently waive a mismatch: unexplained source/member changes block readiness.

## Independent review and explicit decisions

Before requesting publication approval, provide the signed candidate SHA, complete
diff, cleanup inventory, exact verification results, source/build comparisons,
license/dependency findings and redacted history/log/artifact disclosure review.
Keep unresolved acceptance items visible; no full WCAG, semantic-grounding,
production-security or universal reproducibility certification is claimed.

Required maintainer decisions include:

- Accept disclosed prototype and historical publication risks.
- Enable and verify a private vulnerability-reporting channel (or publish a
  verified private contact); see [SECURITY.md](../SECURITY.md).
- Approve any remaining advisory/license findings with a documented disposition.
- Separately authorize branch publication/merge, repository visibility conversion,
  signed release tag, GitHub Release and deployment. None follows automatically
  from completing local gates or independent review.

Do not rewrite history or remove original findings. Keep cleanup, documentation
and version changes separately reviewable. Stop local preparation after verification
and independent-review handoff.

## Authorized publication/deployment gates (future actions)

After explicit approval, recheck exact branch/head, clean tree, signatures, privacy
and remote CI on both candidate and merge. Preserve reviewed history. The signed
annotated `v0.1.0` tag must resolve to the exact approved release commit, with
matching package/Cargo/app metadata and release notes. Publishing a GitHub Release
or changing visibility requires its own authorization.

Before an authorized deployment, identify the existing target and rollback artifact
privately. Use the complete exact-commit static artifact and corresponding source
archive. Do not commit host details or secrets. After deployment verify build
identity, complete artifact/security headers, Chromium/Firefox Chat/Studio/audio,
source navigation, EN/DE notices, appearance modes and responsive keyboard behavior:

```sh
pnpm hosting:check --url <https-origin> --release <release-directory>
RESEARCHBENCH_HOSTING_URL=<https-origin> pnpm test:hosting
```

Provider calls in hosting tests are mocked. Actual entitlements and listening
quality require separate authorized real-key acceptance. Preserve old matching
source archives/licenses across rollback for existing tabs. Record CI, artifact,
publication and deployment as distinct outcomes. Do not start another milestone.
