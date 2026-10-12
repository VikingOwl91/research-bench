#!/usr/bin/env node
/** Reproduce only the pinned files in assets-manifest.json. No implicit latest downloads. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'scripts/assets-manifest.json'), 'utf8'));
const verifyOnly = process.argv.includes('--verify');
const hash = b => createHash('sha256').update(b).digest('hex');
async function valid(file) {
  try { const b = await readFile(resolve(root, file.path)); return hash(b) === file.sha256 && b.length === file.bytes; }
  catch { return false; }
}
async function save(file, bytes) {
  if (hash(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Integrity mismatch: ${file.path}`);
  const dest = resolve(root, file.path); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, bytes);
}
async function download(url) {
  const response = await fetch(url); if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const all = [...manifest.embedding.files, ...manifest.pdfium.files, ...manifest.runtime.files, ...(manifest.notices ?? [])];
if (verifyOnly) {
  const missing = [];
  for (const file of all) if (!await valid(file)) missing.push(file.path);
  if (missing.length) throw new Error(`Missing or modified assets:\n${missing.join('\n')}\nRun npm run assets:prepare.`);
} else {
  for (const file of [...manifest.embedding.files, ...(manifest.notices ?? [])]) if (!await valid(file)) {
    let bytes = await download(file.url);
    if (file.downloadEncoding === 'base64') bytes = Buffer.from(bytes.toString('ascii'), 'base64');
    await save(file, bytes);
  }
  if ((await Promise.all(manifest.pdfium.files.map(valid))).some(x => !x)) {
    const archive = await download(manifest.pdfium.url);
    if (hash(archive) !== manifest.pdfium.sha256) throw new Error('Pdfium archive checksum mismatch');
    // Python's standard library extracts explicit members only; no untrusted archive paths reach disk.
    for (const file of manifest.pdfium.files) {
      const extracted = spawnSync('python3', ['-c', 'import sys,zipfile,io;sys.stdout.buffer.write(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read(sys.argv[1]))', file.member], { input: archive, maxBuffer: 64 * 1024 * 1024 });
      if (extracted.status !== 0) throw new Error(`Pdfium extraction failed: ${extracted.stderr}`);
      await save(file, extracted.stdout);
    }
  }
  const require = createRequire(resolve(root, 'package.json'));
  const transformersPackage = resolve(dirname(require.resolve('@huggingface/transformers')), '..');
  const runtimePackage = resolve(dirname(createRequire(resolve(transformersPackage, 'package.json')).resolve('onnxruntime-web')), '..');
  const metadata = JSON.parse(await readFile(resolve(runtimePackage, 'package.json'), 'utf8'));
  if (metadata.version !== manifest.runtime.version) throw new Error(`ONNX runtime version changed: ${metadata.version}; review and regenerate the manifest deliberately.`);
  for (const file of manifest.runtime.files) if (!await valid(file)) await save(file, await readFile(resolve(runtimePackage, 'dist', file.name)));
}
console.log(`Verified ${all.length} self-hosted files (${Math.round(all.reduce((n, f) => n + f.bytes, 0) / 1024 / 1024)} MiB).`);
