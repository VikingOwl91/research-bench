#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fstatSync } from 'node:fs';
import { remapEnvironmentKey } from './wasm-build-env.mjs';

// Cargo has already resolved flags from config, environment and target
// settings. Forward those arguments unchanged and append only path remaps.
// RUSTC_WORKSPACE_WRAPPER, when configured, is the first argument from Cargo
// and remains in the chain. The explicit project wrapper is opt-in as before.
try {
  const configuration = JSON.parse(process.env[remapEnvironmentKey] || 'null');
  if (!configuration || !Array.isArray(configuration.mappings) || !configuration.mappings.length ||
      !configuration.mappings.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string' && value.length))) {
    throw new Error('Missing or invalid Rust path-remapping configuration.');
  }
  const [compiler, ...args] = process.argv.slice(2);
  if (!compiler) throw new Error('Missing Rust compiler or workspace wrapper.');
  const remaps = configuration.mappings.map(([source, replacement]) => `--remap-path-prefix=${source}=${replacement}`);
  const command = configuration.compilerWrapper || compiler;
  const forwarded = configuration.compilerWrapper ? [compiler, ...args, ...remaps] : [...args, ...remaps];
  // Cargo passes its jobserver pipe handles to compiler wrappers. Node's
  // default stdio inheritance covers only 0-2, so explicitly preserve the
  // advertised pair, never unrelated inherited file descriptors.
  const stdio = ['inherit', 'inherit', 'inherit'];
  const pairs = [...(process.env.CARGO_MAKEFLAGS || '').matchAll(/(?:^|\s)--jobserver-(?:auth|fds)=(\d+),(\d+)(?=\s|$)/g)]
    .map(match => [Number(match[1]), Number(match[2])]);
  if (pairs.length && pairs.some(pair => pair.some((fd, index) => fd !== pairs[0][index]))) {
    throw new Error('Conflicting Cargo jobserver descriptors.');
  }
  for (const fd of new Set(pairs[0] || [])) {
    if (!Number.isSafeInteger(fd) || fd < 3 || !fstatSync(fd).isFIFO()) {
      throw new Error('Invalid Cargo jobserver pipe descriptor.');
    }
    while (stdio.length <= fd) stdio.push('ignore');
    stdio[fd] = fd;
  }
  const result = spawnSync(command, forwarded, { env: process.env, stdio });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
} catch (error) {
  // Error details can contain private compiler paths. Keep failures actionable
  // without copying an environment-dependent command or arguments to CI logs.
  console.error(`Rust path-remapping wrapper failed (${error.code || 'invalid configuration'}).`);
  process.exitCode = 1;
}
