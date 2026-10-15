import { spawnSync } from 'node:child_process';
import { constants, openSync, closeSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWasmBuildEnvironment, remapEnvironmentKey } from '../../scripts/wasm-build-env.mjs';

const wrapperPath = resolve('scripts/rustc-path-remap.mjs');
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'researchbench-remap-test-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
function options(overrides = {}) {
  return {
    root: dir, targetDirectory: join(dir, 'original target'), wrapperPath,
    wrapperContents: 'wrapper version one', env: { ...process.env, CARGO_HOME: join(dir, 'cargo home'), RESEARCHBENCH_RUSTC_WRAPPER: '' },
    ...overrides,
  };
}
function executable(name: string, program: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!${process.execPath}\n${program}\n`); chmodSync(path, 0o755); return path;
}
function captureCompiler() {
  const output = join(dir, 'captured.json');
  const compiler = executable('compiler with spaces', `require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({ args: process.argv.slice(2), flags: process.env.RUSTFLAGS, encoded: process.env.CARGO_ENCODED_RUSTFLAGS }));`);
  return { output, compiler };
}
function invoke(compiler: string, args: string[] = [], overrides = {}) {
  const build = createWasmBuildEnvironment(options(overrides));
  return { build, result: spawnSync(process.execPath, [wrapperPath, compiler, ...args], { cwd: dir, env: build.env, encoding: 'utf8' }) };
}

describe('Cargo path-remapping environment', () => {
  it('preserves resolved flags and unrelated environment without mutating the input', () => {
    const env = { RUSTFLAGS: '-C opt-level=1 --cfg custom', CARGO_ENCODED_RUSTFLAGS: '-C\u001fdebuginfo=1', CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: '--cfg=target', RUSTC_WORKSPACE_WRAPPER: 'workspace-wrapper', CUSTOM: 'unchanged' };
    const before = { ...env }, build = createWasmBuildEnvironment(options({ env }));
    expect(env).toEqual(before);
    for (const [key, value] of Object.entries(env)) expect((build.env as NodeJS.ProcessEnv)[key]).toBe(value);
    expect(build.env.RUSTC_WRAPPER).toBe(wrapperPath);
  });
  it('maps custom Cargo home and source paths with spaces to neutral prefixes', () => {
    const build = createWasmBuildEnvironment(options());
    expect(build.mappings).toContainEqual([dir, '/researchbench']);
    expect(build.mappings).toContainEqual([join(dir, 'cargo home'), '/cargo']);
    expect(build.mappings).toContainEqual([build.targetDirectory, '/target']);
    expect(build.targetDirectory).toMatch(/original target\/researchbench-remapped\/[a-f0-9]{24}$/);
  });
  it('covers both lexical and real source/Cargo paths', () => {
    const real = join(dir, 'actual'); mkdirSync(real);
    const alias = join(dir, 'alias'); symlinkSync(real, alias);
    const build = createWasmBuildEnvironment(options({ root: alias, env: { CARGO_HOME: alias } }));
    expect(build.mappings).toContainEqual([alias, '/researchbench']);
    expect(build.mappings).toContainEqual([real, '/researchbench']);
    expect(build.mappings).toContainEqual([alias, '/cargo']);
    expect(build.mappings).toContainEqual([real, '/cargo']);
    const nested = createWasmBuildEnvironment(options({ targetDirectory: join(alias, 'not-created-yet', 'target') }));
    expect(nested.mappings).toContainEqual([nested.targetDirectory.replace(alias, real), '/target']);
  });
  it('uses a stable warm namespace but isolates old and changed mapping builds', () => {
    const base = options(), first = createWasmBuildEnvironment(base);
    expect(createWasmBuildEnvironment(base).targetDirectory).toBe(first.targetDirectory);
    for (const override of [
      { wrapperContents: 'wrapper version two' }, { root: join(dir, 'other checkout') },
      { targetDirectory: join(dir, 'other target') }, { env: { CARGO_HOME: join(dir, 'other cargo') } },
      { env: { RESEARCHBENCH_RUSTC_WRAPPER: '/custom/compiler-wrapper' } },
    ]) expect(createWasmBuildEnvironment({ ...base, ...override }).targetDirectory).not.toBe(first.targetDirectory);
    expect(first.targetDirectory).not.toBe(base.targetDirectory);
  });
  it('makes the more specific target prefix win over its checkout parent', () => {
    const build = createWasmBuildEnvironment(options());
    expect(build.mappings.findIndex(([path]: string[]) => path === build.targetDirectory)).toBeGreaterThan(build.mappings.findIndex(([path]: string[]) => path === dir));
  });
  it('rejects an explicit project wrapper pointing back to itself, including aliases', () => {
    expect(() => createWasmBuildEnvironment(options({ env: { RESEARCHBENCH_RUSTC_WRAPPER: wrapperPath } }))).toThrow('itself');
    const alias = join(dir, 'wrapper alias'); symlinkSync(wrapperPath, alias);
    expect(() => createWasmBuildEnvironment(options({ env: { RESEARCHBENCH_RUSTC_WRAPPER: alias } }))).toThrow('itself');
    const command = 'remap-wrapper'; symlinkSync(wrapperPath, join(dir, command));
    expect(() => createWasmBuildEnvironment(options({ env: { PATH: dir, RESEARCHBENCH_RUSTC_WRAPPER: command } }))).toThrow('itself');
  });
});

describe('compiler wrapper forwarding', () => {
  it('is executable for Cargo rather than relying on an implicit shell', () => {
    expect(statSync(wrapperPath).mode & 0o111).not.toBe(0);
  });
  it('preserves Cargo-resolved config/target flags and arguments with spaces', () => {
    const { compiler, output } = captureCompiler();
    const flags = ['--crate-name', 'fixture', '-C', 'opt-level=s', '--cfg', 'from_config', '--cfg', 'target_config', join(dir, 'source file.rs')];
    const env = { ...process.env, RUSTFLAGS: '-C opt-level=2', CARGO_ENCODED_RUSTFLAGS: '--cfg\u001ffrom_encoded' };
    const { result, build } = invoke(compiler, flags, { env });
    expect(result.status).toBe(0);
    const captured = JSON.parse(readFileSync(output, 'utf8'));
    expect(captured.args).toEqual([...flags, ...build.mappings.map(([from, to]: string[]) => `--remap-path-prefix=${from}=${to}`)]);
    expect(captured.flags).toBe(env.RUSTFLAGS); expect(captured.encoded).toBe(env.CARGO_ENCODED_RUSTFLAGS);
  });
  it('forwards Cargo compiler-version probes', () => {
    const { compiler, output } = captureCompiler(), { result } = invoke(compiler, ['-vV']);
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8')).args[0]).toBe('-vV');
  });
  it('keeps a workspace wrapper in the compiler chain and chains only the explicit project override', () => {
    const { compiler, output } = captureCompiler();
    const workspace = executable('workspace wrapper', `const { spawnSync } = require('node:child_process'); const r = spawnSync(process.argv[2], process.argv.slice(3), {stdio: 'inherit'}); process.exit(r.status ?? 1);`);
    const projectLog = join(dir, 'project-wrapper.json');
    const project = executable('project wrapper', `require('node:fs').writeFileSync(${JSON.stringify(projectLog)}, JSON.stringify(process.argv.slice(2))); const {spawnSync}=require('node:child_process'); const r=spawnSync(process.argv[2],process.argv.slice(3),{stdio:'inherit'}); process.exit(r.status ?? 1);`);
    const { result } = invoke(workspace, [compiler, '--cfg', 'workspace_test'], { env: { ...process.env, RUSTC_WRAPPER: '/unavailable-global-daemon', RUSTC_WORKSPACE_WRAPPER: workspace, RESEARCHBENCH_RUSTC_WRAPPER: project } });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(projectLog, 'utf8')).slice(0, 2)).toEqual([workspace, compiler]);
    expect(JSON.parse(readFileSync(output, 'utf8')).args.slice(0, 2)).toEqual(['--cfg', 'workspace_test']);
  });
  it('preserves only Cargo-advertised jobserver pipe descriptors', () => {
    const fifo = join(dir, 'jobserver pipe');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const pipe = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
    const privateFile = join(dir, 'unadvertised descriptor'); writeFileSync(privateFile, 'not forwarded');
    const unrelated = openSync(privateFile, constants.O_RDONLY);
    const output = join(dir, 'descriptor-capture.json');
    const compiler = executable('descriptor compiler', `const fs=require('node:fs'); const result={three:fs.fstatSync(3).isFIFO(),five:fs.fstatSync(5).isFIFO()}; try { result.unrelated=fs.readlinkSync('/proc/self/fd/7'); } catch {} fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(result));`);
    const build = createWasmBuildEnvironment(options({ env: { ...process.env, CARGO_MAKEFLAGS: '-j --jobserver-fds=3,5 --jobserver-auth=3,5' } }));
    try {
      const result = spawnSync(process.execPath, [wrapperPath, compiler], { cwd: dir, env: build.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', pipe, 'ignore', pipe, 'ignore', unrelated] });
      expect(result.status, result.stderr).toBe(0);
      const captured = JSON.parse(readFileSync(output, 'utf8'));
      expect(captured.three).toBe(true); expect(captured.five).toBe(true);
      expect(captured.unrelated).not.toBe(privateFile);
    } finally { closeSync(pipe); closeSync(unrelated); }
  });
  it('refuses a regular file advertised as a jobserver pipe', () => {
    const file = join(dir, 'not a jobserver pipe'); writeFileSync(file, 'private'); const fd = openSync(file, constants.O_RDONLY);
    const { compiler, output } = captureCompiler();
    const build = createWasmBuildEnvironment(options({ env: { ...process.env, CARGO_MAKEFLAGS: '--jobserver-auth=3,3' } }));
    try {
      const result = spawnSync(process.execPath, [wrapperPath, compiler], { cwd: dir, env: build.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', fd] });
      expect(result.status).toBe(1); expect(result.stderr).toContain('wrapper failed'); expect(() => readFileSync(output)).toThrow();
    } finally { closeSync(fd); }
  });
  it('propagates nonzero compiler status', () => {
    const compiler = executable('failure', 'process.exit(37);');
    expect(invoke(compiler).result.status).toBe(37);
  });
  it('propagates compiler termination signals', () => {
    const compiler = executable('signal', "process.kill(process.pid, 'SIGTERM');");
    expect(invoke(compiler).result.signal).toBe('SIGTERM');
  });
  it('fails closed when configuration is missing or malformed', () => {
    const { compiler, output } = captureCompiler();
    for (const value of ['', '{}', '{', JSON.stringify({ mappings: [['', '/cargo']] })]) {
      const result = spawnSync(process.execPath, [wrapperPath, compiler], { env: { ...process.env, [remapEnvironmentKey]: value }, encoding: 'utf8' });
      expect(result.status).toBe(1); expect(result.stderr).toContain('wrapper failed');
    }
    expect(() => readFileSync(output)).toThrow();
  });
  it('reports failed compiler startup without exposing private command paths', () => {
    const missing = join(dir, 'private nonexistent compiler');
    const result = invoke(missing).result;
    expect(result.status).toBe(1); expect(result.stderr).toContain('ENOENT'); expect(result.stderr).not.toContain(dir);
  });
});

describe('real Cargo configuration compatibility', () => {
  it.each(['config', 'environment', 'encoded', 'encoded-empty'])('preserves %s compiler flags and Cargo-configured target directory', mode => {
    const crate = join(dir, 'crate with spaces'); mkdirSync(join(crate, 'src'), { recursive: true }); mkdirSync(join(crate, '.cargo'));
    writeFileSync(join(crate, 'Cargo.toml'), '[package]\nname="remap-fixture"\nversion="0.0.0"\nedition="2021"\n');
    writeFileSync(join(crate, '.cargo/config.toml'), '[build]\ntarget-dir="configured target with spaces"\nrustflags=["--cfg", "from_config"]\n');
    const expected = mode === 'config' ? 'from_config' : mode === 'environment' ? 'from_environment' : 'from_encoded';
    const assertion = mode === 'encoded-empty'
      ? '#[cfg(any(from_environment, from_config))] compile_error!("Empty encoded flags must override other flags");'
      : `#[cfg(not(${expected}))] compile_error!("Cargo compiler flag was lost");`;
    writeFileSync(join(crate, 'src/main.rs'), `${assertion}\nfn main() {}\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, CARGO_HOME: join(dir, 'isolated cargo home'), RUSTC_WRAPPER: '', RUSTC_WORKSPACE_WRAPPER: '' };
    delete env.RUSTFLAGS; delete env.CARGO_ENCODED_RUSTFLAGS;
    if (mode !== 'config') env.RUSTFLAGS = '--cfg from_environment';
    if (mode === 'encoded') env.CARGO_ENCODED_RUSTFLAGS = '--cfg\u001ffrom_encoded';
    if (mode === 'encoded-empty') env.CARGO_ENCODED_RUSTFLAGS = '';
    const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd: crate, env, encoding: 'utf8' });
    expect(metadata.status, metadata.stderr).toBe(0);
    const targetDirectory = JSON.parse(metadata.stdout).target_directory;
    expect(targetDirectory).toBe(join(crate, 'configured target with spaces'));
    const build = createWasmBuildEnvironment(options({ root: crate, targetDirectory, env }));
    if (mode === 'encoded-empty') expect((build.env as NodeJS.ProcessEnv).CARGO_ENCODED_RUSTFLAGS).toBe('');
    const result = spawnSync('cargo', ['build', '--offline', '--target-dir', build.targetDirectory], { cwd: crate, env: build.env, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/failed to connect to jobserver|Bad file descriptor|jobserver.*warning/i);
  }, 15_000);
});
