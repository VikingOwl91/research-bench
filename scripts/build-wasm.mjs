import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Must match the crate's exact wasm-bindgen dependency. cargo install uses the
// release's own locked dependency graph and registry content checksums.
const version = '0.2.129';
const root = resolve(import.meta.dirname, '..');
const tools = resolve(root, '.cache', 'tools', `wasm-bindgen-${version}`);
const executable = process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen';
let cli = process.env.RESEARCHBENCH_WASM_BINDGEN || resolve(tools, 'bin', executable);

function run(command, args) {
  // Global compiler wrappers may require a host daemon unavailable in a build
  // sandbox. Keep the build independent; an explicit project override is opt-in.
  const env = { ...process.env, RUSTC_WRAPPER: process.env.RESEARCHBENCH_RUSTC_WRAPPER || '' };
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
run('cargo', ['build', '--manifest-path', 'crates/research-core/Cargo.toml', '--locked', '--release', '--target', 'wasm32-unknown-unknown']);
mkdirSync(resolve(root, 'src/lib/wasm'), { recursive: true });
run(cli, [
  'crates/research-core/target/wasm32-unknown-unknown/release/research_core.wasm',
  '--target', 'web', '--out-dir', 'src/lib/wasm', '--out-name', 'research_core',
]);
console.log('Rust/WASM built: src/lib/wasm/research_core.js');
