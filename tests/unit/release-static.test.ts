import { spawnSync } from 'node:child_process';
import { physicalAssetPath } from '../../scripts/model-assets.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createManifest, safeRelativePath, prepareRelease, verifyRelease } from '../../scripts/release-static.mjs';
import { prepareSourceOffer } from '../../scripts/source-offer.mjs';

let dir: string;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function save(path: string, value: string) { await mkdir(join(dir, 'build', path, '..'), { recursive: true }); await writeFile(join(dir, 'build', path), value); }
async function fixture() {
  const assets = [];
  for (let i = 0; i < 27; i++) {
    const path = `models/multilingual-e5-small/model-${i}.bin`, value = `pinned-${i}`;
    assets.push({ path: `static/${path}`, sha256: hash(value), bytes: Buffer.byteLength(value) });
  }
  await save('index.html', '<h1>ResearchBench</h1>');
  await save('_app/immutable/workers/pipeline.worker-abc.js', 'pipeline');
  await save('_app/immutable/workers/encoder.worker-def.js', 'encoder');
  await save('_app/immutable/workers/assets/research_core_bg-ghi.wasm', 'wasm');
  const assetsManifestPath = join(dir, 'assets.json');
  const manifest = { embedding: { files: assets }, pdfium: { files: [] },
    runtime: { files: [] }, audioEncoder: { files: [] }, notices: [] };
  await writeFile(assetsManifestPath, JSON.stringify(manifest));
  for (let i = 0; i < assets.length; i++) await save(physicalAssetPath(assets[i], manifest).slice(7), `pinned-${i}`);
  return { buildDir: join(dir, 'build'), outputRoot: join(dir, 'releases'), assetsManifestPath, repoRoot: dir };
}
function git(...args: string[]) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  expect(result.status).toBe(0); return result.stdout.trim();
}
async function committedFixture(version = '0.0.2') {
  const options = await fixture();
  git('init', '-q'); git('config', 'user.name', 'Release test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(dir, '.gitignore'), 'releases/\nbuild/\n');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version }));
  await writeFile(join(dir, 'LICENSE'), 'Fixture license\n');
  git('add', '.'); git('commit', '-qm', 'Fixture');
  const expectedHead = git('rev-parse', 'HEAD');
  await compiledVersion(`${version}+${expectedHead}`);
  return { ...options, requireClean: true, expectedHead };
}
async function compiledVersion(version: string, bootstrapVersion = version) {
  await save('_app/version.json', JSON.stringify({ version }));
  await save('index.html', `<html><script>__sveltekit_fixture = {version: ${JSON.stringify(bootstrapVersion)}};</script></html>`);
}
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'researchbench-release-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('immutable release preparation', () => {
  it.each(['0.0.3-beta', '0.0.4-rc.1'])('requires the source offer for prerelease %s', async version => {
    const strict = await committedFixture(version);
    await expect(prepareRelease(strict)).rejects.toMatchObject({ code: 'ENOENT' });
    await prepareSourceOffer(strict);
    const release = await prepareRelease(strict);
    await expect(verifyRelease(release.releaseDir, strict)).resolves.toEqual(release);
  });
  it('requires exact source and license offers for new production releases and includes their bytes in the snapshot', async () => {
    const strict = await committedFixture('0.0.3');
    await expect(prepareRelease(strict)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(strict.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await prepareSourceOffer(strict);
    const release = await prepareRelease(strict);
    const manifest = JSON.parse(await readFile(join(release.releaseDir, 'manifest.json'), 'utf8'));
    expect(manifest.files.filter((file: { path: string }) => file.path.startsWith('source/'))).toHaveLength(2);
    await expect(verifyRelease(release.releaseDir, strict)).resolves.toEqual(release);
    await writeFile(join(strict.buildDir, 'source', `researchbench-${strict.expectedHead}.license.txt`), 'wrong');
    await expect(prepareRelease(strict)).rejects.toThrow('license differs');
  });
  it('hashes sorted paths and bytes deterministically and never rewrites an existing release', async () => {
    const options = await fixture();
    const first = await prepareRelease(options);
    const metadataPath = join(first.releaseDir, 'release.json');
    const metadata = await readFile(metadataPath, 'utf8');
    const modified = (await stat(metadataPath)).mtimeMs;
    const second = await prepareRelease(options);
    expect(second).toEqual(first);
    expect((await stat(metadataPath)).mtimeMs).toBe(modified);
    expect(await readFile(metadataPath, 'utf8')).toBe(metadata);
    const manifest = await readFile(join(first.releaseDir, 'manifest.json'), 'utf8');
    expect(hash(manifest)).toBe(first.artifactId);
    expect(first.count).toBe(31);
    expect(await verifyRelease(first.releaseDir)).toEqual(first);
    const parsed = JSON.parse(manifest);
    expect(parsed.files.map((file: { path: string }) => file.path)).toEqual(parsed.files.map((file: { path: string }) => file.path).sort());
    expect(JSON.parse(metadata).provenance.head).toBeNull();
  });
  it('rejects pinned asset corruption before publishing a release', async () => {
    const options = await fixture(); const pinned = JSON.parse(await readFile(options.assetsManifestPath, 'utf8'));
    await save(physicalAssetPath(pinned.embedding.files[0], pinned).slice(7), 'tampered');
    await expect(prepareRelease(options)).rejects.toThrow('Pinned asset mismatch');
    await expect(stat(options.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects corruption and extra files in an existing snapshot without rewriting it', async () => {
    const options = await fixture(); const release = await prepareRelease(options);
    await writeFile(join(release.releaseDir, 'site/index.html'), 'corrupt');
    await expect(prepareRelease(options)).rejects.toThrow('inventory or bytes mismatch');
    expect(await readFile(join(release.releaseDir, 'site/index.html'), 'utf8')).toBe('corrupt');
    await writeFile(join(release.releaseDir, 'site/index.html'), '<h1>ResearchBench</h1>');
    await writeFile(join(release.releaseDir, 'site/extra.js'), 'extra');
    await expect(verifyRelease(release.releaseDir)).rejects.toThrow('inventory or bytes mismatch');
  });
  it('fails closed when an existing release has incomplete metadata', async () => {
    const options = await fixture(); const release = await prepareRelease(options);
    await rm(join(release.releaseDir, 'release.json'));
    await expect(prepareRelease(options)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(release.releaseDir, 'release.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects symlinks, unsafe paths, and missing built worker or WASM artifacts', async () => {
    const options = await fixture();
    await symlink(join(options.buildDir, 'index.html'), join(options.buildDir, 'alias.html'));
    await expect(createManifest(options.buildDir)).rejects.toThrow('Symlink rejected');
    await rm(join(options.buildDir, 'alias.html'));
    for (const path of ['../secret', '/index.html', 'a//b', 'a/./b', 'a\nb', 'a b', 'a;touch', 'a\\b', '-option']) {
      expect(() => safeRelativePath(path)).toThrow('Unsafe relative file path');
    }
    await rm(join(options.buildDir, '_app/immutable/workers/encoder.worker-def.js'));
    await expect(prepareRelease(options)).rejects.toThrow('Missing built runtime artifact');
  });
  it('rejects altered manifests, sums, and nested output roots', async () => {
    const options = await fixture(); const release = await prepareRelease(options);
    await writeFile(join(release.releaseDir, 'SHA256SUMS'), 'altered');
    await expect(verifyRelease(release.releaseDir)).rejects.toThrow('SHA256SUMS mismatch');
    await writeFile(join(release.releaseDir, 'manifest.json'), '{"schemaVersion":1,"files":[{"path":"../secret","sha256":"' + hash('x') + '","bytes":1}]}');
    await expect(verifyRelease(release.releaseDir)).rejects.toThrow('Unsafe relative file path');
    await expect(prepareRelease({ ...options, outputRoot: join(options.buildDir, 'release') })).rejects.toThrow('outside build directory');
  });
  it('rejects legacy duplicate model paths without publishing them', async () => {
    const options = await fixture(); await save('models/multilingual-e5-small/model-0.bin', 'pinned-0');
    await expect(prepareRelease(options)).rejects.toThrow('Unexpected or legacy model directory');
  });
  it('requires explicit full SHA and a clean verified Git tree for production snapshots', async () => {
    const options = await fixture();
    await expect(prepareRelease({ ...options, requireClean: true })).rejects.toThrow('explicit expected HEAD');
    await expect(prepareRelease({ ...options, requireClean: true, expectedHead: 'abc' })).rejects.toThrow('full Git SHA');
    await expect(prepareRelease({ ...options, requireClean: true, expectedHead: 'a'.repeat(40) })).rejects.toThrow('HEAD mismatch');
    const strict = await committedFixture();
    const expectedHead = strict.expectedHead;
    const release = await prepareRelease(strict);
    expect(JSON.parse(await readFile(join(release.releaseDir, 'release.json'), 'utf8')).provenance.dirty).toBe(false);
    await expect(verifyRelease(release.releaseDir, { requireClean: true, expectedHead })).resolves.toEqual(release);
    await expect(verifyRelease(release.releaseDir, { requireClean: true, expectedHead: 'b'.repeat(40) })).rejects.toThrow('HEAD mismatch');
    await writeFile(join(dir, 'untracked-source.ts'), 'new source');
    await expect(prepareRelease(strict)).rejects.toThrow('verified clean source tree');
  });
  it('does not reuse dirty or different-HEAD provenance as a committed release', async () => {
    const options = await fixture(); const release = await prepareRelease(options);
    const metadataPath = join(release.releaseDir, 'release.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    metadata.provenance = { head: 'a'.repeat(40), dirty: true };
    await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(verifyRelease(release.releaseDir, { requireClean: true, expectedHead: 'a'.repeat(40) })).rejects.toThrow('verified clean source tree');
    metadata.provenance.dirty = false; await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(verifyRelease(release.releaseDir, { requireClean: true, expectedHead: 'b'.repeat(40) })).rejects.toThrow('HEAD mismatch');
  });

  it('rejects stale compiled A bytes despite clean HEAD B before creating a snapshot', async () => {
    const strict = await committedFixture();
    await writeFile(join(dir, 'source.ts'), 'Changed committed source'); git('add', 'source.ts'); git('commit', '-qm', 'Candidate B');
    const expectedHead = git('rev-parse', 'HEAD');
    expect(expectedHead).not.toBe(strict.expectedHead);
    expect(git('status', '--porcelain')).toBe('');
    await expect(prepareRelease({ ...strict, expectedHead })).rejects.toThrow('Compiled build version differs');
    await expect(stat(strict.outputRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects missing version JSON or a mismatched bootstrap version', async () => {
    const strict = await committedFixture();
    await rm(join(strict.buildDir, '_app/version.json'));
    await expect(prepareRelease(strict)).rejects.toThrow('Missing compiled build version');
    await compiledVersion(`0.0.2+${strict.expectedHead}`, `0.0.2+${'a'.repeat(40)}`);
    await expect(prepareRelease(strict)).rejects.toThrow('Bootstrap version differs');
    await compiledVersion(`9.9.9+${strict.expectedHead}`);
    await expect(prepareRelease(strict)).rejects.toThrow('Compiled build version differs');
  });
  it('strict verification checks compiled site identity and metadata HEAD independently', async () => {
    const strict = await committedFixture(); const release = await prepareRelease(strict);
    const metadataPath = join(release.releaseDir, 'release.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    expect(metadata.buildVersion).toBe(`0.0.2+${strict.expectedHead}`);
    metadata.provenance.head = 'b'.repeat(40);
    await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(verifyRelease(release.releaseDir, { requireClean: true, expectedHead: 'b'.repeat(40) })).rejects.toThrow('metadata build version does not match provenance HEAD');
    metadata.provenance.head = strict.expectedHead; await writeFile(metadataPath, JSON.stringify(metadata));
    await writeFile(join(release.releaseDir, 'site/_app/version.json'), JSON.stringify({ version: `9.9.9+${strict.expectedHead}` }));
    await expect(verifyRelease(release.releaseDir, strict)).rejects.toThrow('Compiled build version differs');
  });

});
