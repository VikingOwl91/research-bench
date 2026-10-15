import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, resolve, sep } from 'node:path';

export const remapEnvironmentKey = 'RESEARCHBENCH_RUST_PATH_REMAP';

// Both Cargo and a symlinked checkout can pass lexical or physical paths to
// rustc. Remap both spellings without requiring a target directory to exist.
export function pathSpellings(path, cwd) {
  const lexical = resolve(cwd, path);
  let existing = lexical;
  const missing = [];
  while (true) {
    try { return [...new Set([lexical, resolve(realpathSync(existing), ...missing)])]; }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(basename(existing)); existing = parent;
    }
  }
}

export function createWasmBuildEnvironment({ root, targetDirectory, wrapperPath, wrapperContents, env = process.env }) {
  const cargoHome = env.CARGO_HOME || resolve(homedir(), '.cargo');
  const roots = pathSpellings(root, root);
  const cargoHomes = pathSpellings(cargoHome, root);
  const targets = pathSpellings(targetDirectory, root);
  const wrappers = pathSpellings(wrapperPath, root);
  const compilerWrapper = env.RESEARCHBENCH_RUSTC_WRAPPER || '';
  const compilerWrapperCandidates = compilerWrapper.includes(sep) || !compilerWrapper
    ? [compilerWrapper]
    : (env.PATH || '').split(delimiter).map(directory => resolve(root, directory, compilerWrapper));
  if (compilerWrapper && compilerWrapperCandidates.some(candidate => pathSpellings(candidate, root).some(path => wrappers.includes(path)))) {
    throw new Error('RESEARCHBENCH_RUSTC_WRAPPER cannot refer to the path-remapping wrapper itself.');
  }
  // Separate remapped outputs from old Cargo caches. The actual namespace is
  // deliberately not an input to its own key. Include wrapper source so a
  // remapping change cannot reuse artifacts produced by an earlier wrapper.
  const key = createHash('sha256').update(JSON.stringify({
    version: 1, wrapperContents, roots, cargoHomes, targets, compilerWrapper,
    workspaceWrapper: env.RUSTC_WORKSPACE_WRAPPER || '',
  })).digest('hex').slice(0, 24);
  const isolatedTarget = resolve(targetDirectory, 'researchbench-remapped', key);
  const mappings = [
    ...roots.map(path => [path, '/researchbench']),
    ...cargoHomes.map(path => [path, '/cargo']),
    ...pathSpellings(isolatedTarget, root).map(path => [path, '/target']),
  ];
  // rustc uses the last matching mapping. More specific prefixes must win.
  mappings.sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]));
  return {
    targetDirectory: isolatedTarget,
    mappings,
    env: {
      ...env,
      RUSTC_WRAPPER: resolve(wrapperPath),
      [remapEnvironmentKey]: JSON.stringify({ mappings, compilerWrapper }),
    },
  };
}
