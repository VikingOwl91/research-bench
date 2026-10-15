import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectPathBytes, checkBuildPaths } from '../../scripts/check-build-paths.mjs';

let dir: string;
const corePath = '_app/immutable/workers/assets/research_core_bg-test.wasm';
function wasm(text = '') {
  const data = Buffer.concat([Buffer.from([4]), Buffer.from('test'), Buffer.from(text)]);
  const size = []; let remaining = data.length;
  do { size.push((remaining & 127) | (remaining > 127 ? 128 : 0)); remaining >>>= 7; } while (remaining);
  return Buffer.concat([Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, ...size]), data]);
}
async function fixture(text = '/cargo/registry/src/public/example-1.0/src/lib.rs') {
  const buildDir = join(dir, 'build'), generatedWasm = join(dir, 'generated.wasm');
  await mkdir(join(buildDir, corePath, '..'), { recursive: true });
  await writeFile(join(buildDir, corePath), wasm(text));
  await writeFile(generatedWasm, wasm(text));
  return { buildDir, generatedWasm };
}
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'researchbench-paths-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('distributed build paths', () => {
  it.each([
    '/home/private-builder/.cargo/registry/src/example/lib.rs',
    '/Users/private-builder/.cargo/registry/src/example/lib.rs',
    'C:\\Users\\private-builder\\.cargo\\registry\\src\\example\\lib.rs',
    '/opt/custom cargo/registry/src/example/lib.rs',
    'D:\\build-cache\\registry\\src\\example\\lib.rs',
  ])('rejects identifiable or unneutralized absolute paths: %s', value => {
    expect(inspectPathBytes(Buffer.from(value)).findings.length).toBeGreaterThan(0);
  });
  it('allows neutral source locations and the pinned runtime virtual HOME', () => {
    const result = inspectPathBytes(Buffer.from('/cargo/registry/src/example/lib.rs\0/home/web_user\0/researchbench/src/lib.rs'));
    expect(result.findings).toEqual([]);
    expect(result.neutralCargo).toHaveLength(1);
    expect(result.virtualHomes).toHaveLength(1);
  });
  it('recognizes a custom build prefix without printing its value', () => {
    const value = '/private/custom-builder';
    const result = inspectPathBytes(Buffer.from(`${value}/output.rs`), [value]);
    expect(result.findings).toEqual([{ offset: 0, kind: 'build-location-prefix' }]);
    expect(JSON.stringify(result)).not.toContain(value);
  });
  it('checks the actual distributed WASM and every raw asset', async () => {
    const options = await fixture();
    await writeFile(join(options.buildDir, 'index.html'), '<html>fixture</html>');
    const result = await checkBuildPaths(options);
    expect(result.filesScanned).toBe(2);
    expect(result.findings).toEqual([]);
    expect(result.neutralCargoPaths).toBe(1);
    expect(result.wasmSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('detects a build path spanning model-stream chunks', async () => {
    const options = await fixture();
    const prefix = Buffer.alloc(1024 * 1024 - 8);
    await writeFile(join(options.buildDir, 'model.bin'), Buffer.concat([prefix, Buffer.from('/home/private-builder/build/model.onnx'), Buffer.alloc(100)]));
    const result = await checkBuildPaths(options);
    expect(result.findings).toContainEqual({ file: 'model.bin', offset: prefix.length, kind: 'absolute-home-path' });
  });
  it('requires the generated and distributed WASM to match', async () => {
    const options = await fixture();
    await writeFile(options.generatedWasm, wasm('different'));
    await expect(checkBuildPaths(options)).rejects.toThrow('differs from generated');
  });
  it('rejects invalid WASM even when generated and shipped bytes match', async () => {
    const options = await fixture();
    for (const path of [options.generatedWasm, join(options.buildDir, corePath)]) await writeFile(path, 'invalid');
    await expect(checkBuildPaths(options)).rejects.toThrow('WASM is invalid');
  });
  it('rejects missing core WASM', async () => {
    const options = await fixture();
    await rm(join(options.buildDir, corePath));
    await expect(checkBuildPaths(options)).rejects.toThrow('exactly one');
  });
  it('rejects duplicate or misplaced core modules', async () => {
    const options = await fixture();
    await writeFile(join(options.buildDir, 'research_core_bg-copy.wasm'), wasm());
    await expect(checkBuildPaths(options)).rejects.toThrow('exactly one');
    await rm(join(options.buildDir, corePath));
    await expect(checkBuildPaths(options)).rejects.toThrow('exactly one');
  });
  it('rejects linked asset directories', async () => {
    const options = await fixture();
    await symlink(dir, join(options.buildDir, 'linked'));
    await expect(checkBuildPaths(options)).rejects.toThrow('symlinks');
  });
  it('fails the CLI on a valid module containing identifying metadata, without leaking it', async () => {
    const sensitive = '/home/private-builder/.cargo/registry/src/example/lib.rs';
    const options = await fixture(sensitive);
    const result = spawnSync(process.execPath, [resolve('scripts/check-build-paths.mjs'), options.buildDir, options.generatedWasm], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('absolute-cargo-path');
    expect(result.stdout + result.stderr).not.toContain(sensitive);
  });
});
