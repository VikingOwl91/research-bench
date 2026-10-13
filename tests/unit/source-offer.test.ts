import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareSourceOffer, verifySourceOffer, sourceOfferNames, decodeSourceArchive, safeSourcePath } from '../../scripts/source-offer.mjs';
import { serveBuild } from '../../scripts/serve-build.mjs';

let dir: string;
function git(...args: string[]) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  expect(result.status).toBe(0); return result.stdout.trim();
}
async function fixture() {
  git('init', '-q'); git('config', 'user.name', 'Source test'); git('config', 'user.email', 'test@example.invalid');
  await writeFile(join(dir, '.gitignore'), 'build/\n');
  await writeFile(join(dir, 'LICENSE'), 'Fixture license\n');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ version: '0.0.3' }));
  await mkdir(join(dir, 'src/nested'), { recursive: true });
  await writeFile(join(dir, 'src/nested/program.ts'), 'export const answer = 42;\n');
  await mkdir(join(dir, 'src/routes'));
  for (const route of ['+layout.svelte', '+layout.ts', '+page.svelte']) {
    await writeFile(join(dir, 'src/routes', route), `// Tracked SvelteKit route: ${route}\n`);
  }
  await writeFile(join(dir, 'run.sh'), '#!/bin/sh\necho source\n', { mode: 0o755 });
  git('add', '.'); git('update-index', '--chmod=+x', 'run.sh'); git('commit', '-qm', 'Fixture');
  const expectedHead = git('rev-parse', 'HEAD'), buildDir = join(dir, 'build');
  await mkdir(join(buildDir, '_app'), { recursive: true });
  await writeFile(join(buildDir, '_app/version.json'), JSON.stringify({ version: `0.0.3+${expectedHead}` }));
  await writeFile(join(buildDir, 'index.html'), '<h1>fixture</h1>');
  return { repoRoot: dir, buildDir, expectedHead };
}
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'researchbench-source-test-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('exact corresponding source', () => {
  it('produces identical bytes and reconstructs every tracked Git blob and file mode with standard tar', async () => {
    const options = await fixture(), first = await prepareSourceOffer(options);
    const names = sourceOfferNames(options.expectedHead), path = join(options.buildDir, 'source', names.archive);
    const bytes = await readFile(path), modified = (await stat(path)).mtimeMs;
    expect(await prepareSourceOffer(options)).toEqual(first);
    expect(await readFile(path)).toEqual(bytes); expect((await stat(path)).mtimeMs).toBe(modified);
    expect(bytes.subarray(4, 8)).toEqual(Buffer.alloc(4));
    const entries = decodeSourceArchive(bytes);
    expect(entries.map(entry => entry.path)).toEqual(entries.map(entry => entry.path).sort());
    const provenance = JSON.parse(entries.find(entry => entry.path === 'PROVENANCE.json')!.bytes.toString());
    expect(provenance.tree).toBe(git('rev-parse', 'HEAD^{tree}'));
    expect(entries.filter(entry => entry.path.startsWith('project/')).length).toBe(git('ls-files').split('\n').length);
    for (const route of ['+layout.svelte', '+layout.ts', '+page.svelte']) {
      expect(entries.some(entry => entry.path === `project/src/routes/${route}`)).toBe(true);
    }
    const extract = join(dir, 'build/extracted'); await mkdir(extract);
    const tar = spawnSync('tar', ['-xzf', path, '-C', extract]); expect(tar.status).toBe(0);
    for (const file of provenance.files) {
      const original = spawnSync('git', ['cat-file', 'blob', file.gitBlob], { cwd: dir });
      expect(await readFile(join(extract, 'project', file.path))).toEqual(original.stdout);
      expect((await stat(join(extract, 'project', file.path))).mode & 0o777).toBe(file.mode === '100755' ? 0o755 : 0o644);
    }
    expect(entries.find(entry => entry.path === 'REBUILD.txt')!.bytes.toString()).toContain('git init');
    expect(entries.some(entry => entry.path.includes('.git/'))).toBe(false);
    await expect(verifySourceOffer(options)).resolves.toEqual(first);
  });
  it('refuses dirty, wrong-HEAD and stale-build source offers before publishing', async () => {
    const options = await fixture();
    await expect(prepareSourceOffer({ ...options, expectedHead: 'b'.repeat(40) })).rejects.toThrow('compiled build identity');
    await writeFile(join(dir, 'untracked.ts'), 'new');
    await expect(prepareSourceOffer(options)).rejects.toThrow('clean source tree');
    await rm(join(dir, 'untracked.ts')); await writeFile(join(dir, 'LICENSE'), 'changed');
    await expect(prepareSourceOffer(options)).rejects.toThrow('clean source tree');
    git('checkout', '--', 'LICENSE');
    await writeFile(join(options.buildDir, '_app/version.json'), JSON.stringify({ version: 'stale' }));
    await expect(prepareSourceOffer(options)).rejects.toThrow('compiled build identity');
  });
  it('rejects committed symlinks, submodules and unsafe names', async () => {
    const options = await fixture();
    await symlink('LICENSE', join(dir, 'link')); git('add', 'link'); git('commit', '-qm', 'Link');
    let expectedHead = git('rev-parse', 'HEAD');
    await writeFile(join(options.buildDir, '_app/version.json'), JSON.stringify({ version: `0.0.3+${expectedHead}` }));
    await expect(prepareSourceOffer({ ...options, expectedHead })).rejects.toThrow('symlink, submodule');
    git('rm', 'link');
    expect(spawnSync('git', ['clone', '--quiet', '--no-hardlinks', dir, join(dir, 'submodule')]).status).toBe(0);
    expect(spawnSync('git', ['checkout', '--quiet', options.expectedHead], { cwd: join(dir, 'submodule') }).status).toBe(0);
    git('update-index', '--add', '--cacheinfo', `160000,${options.expectedHead},submodule`); git('commit', '-qm', 'Submodule');
    expectedHead = git('rev-parse', 'HEAD');
    await writeFile(join(options.buildDir, '_app/version.json'), JSON.stringify({ version: `0.0.3+${expectedHead}` }));
    await expect(prepareSourceOffer({ ...options, expectedHead })).rejects.toThrow('symlink, submodule');
    for (const path of ['../secret', '/source', 'a//b', '.git/HEAD', 'a b', '-option', 'a\nb']) expect(() => safeSourcePath(path)).toThrow();
  });
  it('refuses corrupt or additional source output and a symlink output directory', async () => {
    const options = await fixture(); await prepareSourceOffer(options);
    const names = sourceOfferNames(options.expectedHead), path = join(options.buildDir, 'source', names.archive);
    const tar = gunzipSync(await readFile(path));
    const marker = tar.indexOf('export const answer = 42;'); expect(marker).toBeGreaterThan(0); tar[marker] = 88;
    await writeFile(path, gzipSync(tar));
    await expect(verifySourceOffer(options)).rejects.toThrow('inventory mismatch');
    await expect(prepareSourceOffer(options)).rejects.toThrow('Existing source offer differs');
    await rm(join(options.buildDir, 'source'), { recursive: true });
    await symlink(join(options.buildDir, '_app'), join(options.buildDir, 'source'));
    await expect(prepareSourceOffer(options)).rejects.toThrow('Unsafe source output');
  });
  it('serves the anonymous archive with exact MIME, attachment and immutable headers while missing source paths return 404', async () => {
    const options = await fixture(); await prepareSourceOffer(options);
    const names = sourceOfferNames(options.expectedHead), server = await serveBuild({ directory: options.buildDir, port: 0 });
    try {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${server.origin}/source/${names.archive}`, { method });
        expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('application/gzip');
        expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${names.archive}"`);
        expect(response.headers.get('cache-control')).toContain('immutable');
        if (method === 'GET') expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(join(options.buildDir, 'source', names.archive)));
      }
      const license = await fetch(`${server.origin}/source/${names.license}`);
      expect(license.headers.get('content-type')).toBe('text/plain'); expect(await license.text()).toBe('Fixture license\n');
      for (const path of ['/source', '/source/missing', `/source/researchbench-${'b'.repeat(40)}.tar.gz`]) {
        const response = await fetch(server.origin + path); expect(response.status).toBe(404); expect(response.headers.get('content-type')).not.toContain('text/html');
      }
    } finally { await server.close(); }
  });
});
