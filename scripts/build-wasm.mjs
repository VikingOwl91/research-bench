import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createWasmBuildEnvironment } from './wasm-build-env.mjs';
import { resolve } from 'node:path';

// Must match the crate's exact wasm-bindgen dependency. cargo install uses the
// release's own locked dependency graph and registry content checksums.
const version = '0.2.129';
const root = resolve(import.meta.dirname, '..');
const tools = resolve(root, '.cache', 'tools', `wasm-bindgen-${version}`);
const executable = process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen';
let cli = process.env.RESEARCHBENCH_WASM_BINDGEN || resolve(tools, 'bin', executable);

function run(command, args, env = { ...process.env, RUSTC_WRAPPER: process.env.RESEARCHBENCH_RUSTC_WRAPPER || '' }) {
  // Global compiler wrappers may require a host daemon unavailable in a build
  // sandbox. Keep the build independent; an explicit project override is opt-in.
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const probe = spawnSync(cli, ['--version'], { encoding: 'utf8' });
if (probe.status !== 0 || probe.stdout.trim() !== `wasm-bindgen ${version}`) {
  if (process.env.RESEARCHBENCH_WASM_BINDGEN) throw new Error(`RESEARCHBENCH_WASM_BINDGEN must point to wasm-bindgen ${version}`);
  mkdirSync(tools, { recursive: true });
  run('cargo', ['install', 'wasm-bindgen-cli', '--version', version, '--locked', '--root', tools]);
}
// Ask Cargo for its effective target directory rather than guessing whether
// CARGO_TARGET_DIR or a .cargo/config.toml override is active.
const metadata = spawnSync('cargo', ['metadata', '--manifest-path', 'crates/research-core/Cargo.toml', '--locked', '--no-deps', '--format-version', '1'], {
  cwd: root, env: { ...process.env, RUSTC_WRAPPER: process.env.RESEARCHBENCH_RUSTC_WRAPPER || '' }, encoding: 'utf8',
});
if (metadata.error) throw metadata.error;
if (metadata.status !== 0) { process.stderr.write(metadata.stderr); process.exit(metadata.status ?? 1); }
const wrapperPath = resolve(root, 'scripts/rustc-path-remap.mjs');
const remapped = createWasmBuildEnvironment({
  root, targetDirectory: JSON.parse(metadata.stdout).target_directory, wrapperPath,
  wrapperContents: readFileSync(wrapperPath, 'utf8') + readFileSync(resolve(root, 'scripts/wasm-build-env.mjs'), 'utf8'),
});
run('cargo', ['build', '--manifest-path', 'crates/research-core/Cargo.toml', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir', remapped.targetDirectory], remapped.env);
mkdirSync(resolve(root, 'src/lib/wasm'), { recursive: true });
run(cli, [
  resolve(remapped.targetDirectory, 'wasm32-unknown-unknown/release/research_core.wasm'),
  '--target', 'web', '--out-dir', 'src/lib/wasm', '--out-name', 'research_core',
]);
console.log('Rust/WASM built: src/lib/wasm/research_core.js');
