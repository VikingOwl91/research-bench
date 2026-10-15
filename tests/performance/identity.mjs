import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const sha = value => createHash('sha256').update(value).digest('hex');
function manifest(directory, relative = '') {
  return readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) return manifest(directory, path);
    if (!entry.isFile()) throw new Error('Build identity refuses non-regular files');
    return [[path, sha(readFileSync(join(directory, path)))]];
  });
}
/** Identity contains hashes and relative repository paths only; no diff bodies. */
export function captureIdentity() {
  const productionPaths = ['src', 'static', 'crates', 'scripts', 'package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'svelte.config.js'];
  const patch = execFileSync('git', ['diff', 'HEAD', '--binary', '--', ...productionPaths]);
  const files = manifest('build');
  return {
    capturedAtUtc: new Date().toISOString(),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    productionTrackedDirty: patch.length > 0,
    productionTrackedPatchSha256: sha(patch),
    productionPatchPathScope: productionPaths,
    buildFiles: files.length,
    buildManifestSha256: sha(JSON.stringify(files)),
    note: 'HEAD alone does not identify a dirty build. Production patch and complete served build manifest digests identify the frozen measured tree; harness/docs changes are outside the production patch scope.',
  };
}
