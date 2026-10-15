#!/usr/bin/env node
// Exact corresponding source; canonical tar, toolchain-dependent gzip bytes.
// No history, network or Git mutation.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lstat, readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sha = value => /^[a-f0-9]{40}$/.test(value);
export function sourceOfferNames(head) {
  if (!sha(head)) throw new Error('Source offer requires a full 40-character Git SHA');
  return { archive: `researchbench-${head}.tar.gz`, license: `researchbench-${head}.license.txt` };
}
export function safeSourcePath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_.+\/-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('-') || part === '.git')) throw new Error('Unsafe source path');
  return path;
}
function git(repoRoot, args, binary = false) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: binary ? undefined : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.error || result.status !== 0) throw new Error('Cannot verify committed source');
  return binary ? result.stdout : result.stdout.trim();
}
function cleanHead(repoRoot, expectedHead) {
  sourceOfferNames(expectedHead);
  if (git(repoRoot, ['rev-parse', 'HEAD']) !== expectedHead) throw new Error('Source offer HEAD mismatch');
  if (git(repoRoot, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Source offer requires a verified clean source tree');
  return git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
}
function archiveHeader(path, size, mode) {
  safeSourcePath(path);
  const header = Buffer.alloc(512);
  let name = path, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const index = path.lastIndexOf('/'); prefix = path.slice(0, index); name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100) throw new Error('Source path exceeds portable tar limits');
  }
  header.write(name, 0, 100, 'ascii');
  const octal = (number, offset, length) => {
    const value = number.toString(8).padStart(length - 1, '0');
    if (value.length >= length) throw new Error('Source exceeds portable tar limits');
    header.write(`${value}\0`, offset, length, 'ascii');
  };
  octal(mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(size, 124, 12); octal(0, 136, 12);
  header.fill(32, 148, 156); header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii'); header.write(prefix, 345, 155, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}
function encodeArchive(entries) {
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const blocks = [];
  for (const entry of entries) blocks.push(archiveHeader(entry.path, entry.bytes.length, entry.mode), entry.bytes, Buffer.alloc((512 - entry.bytes.length % 512) % 512));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9 }); // Zero timestamp/metadata; deflate bytes may vary with Node/zlib builds.
}
/** Strictly bounded parser for the portable tar subset emitted above. */
export function decodeSourceArchive(bytes) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Source archive exceeds size limit');
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 });
  const entries = []; let offset = 0, previous = '';
  const string = (header, start, end) => header.subarray(start, end).toString('ascii').replace(/\0.*$/s, '');
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (tar.length - offset < 1024 || !tar.subarray(offset).every(byte => byte === 0)) throw new Error('Invalid source tar terminator');
      return entries;
    }
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (Number.parseInt(string(header, 148, 156), 8) !== checksum || string(header, 257, 263) !== 'ustar' || header[156] !== 48) throw new Error('Invalid source tar entry');
    const prefix = string(header, 345, 500), name = string(header, 0, 100);
    const path = safeSourcePath(prefix ? `${prefix}/${name}` : name);
    const number = (start, end) => { const value = string(header, start, end); if (!/^[0-7]+$/.test(value)) throw new Error('Invalid source tar number'); return Number.parseInt(value, 8); };
    const size = number(124, 136), mode = number(100, 108);
    if (path <= previous || ![0o644, 0o755].includes(mode) || number(108, 116) !== 0 || number(116, 124) !== 0 || number(136, 148) !== 0 || !Number.isSafeInteger(size) || offset + 512 + size > tar.length) throw new Error('Invalid source tar metadata');
    offset += 512;
    entries.push({ path, mode, bytes: Buffer.from(tar.subarray(offset, offset + size)) });
    const padding = (512 - size % 512) % 512;
    if (!tar.subarray(offset + size, offset + size + padding).every(byte => byte === 0)) throw new Error('Invalid source tar padding');
    offset += size + padding; previous = path;
  }
  throw new Error('Missing source tar terminator');
}
async function sourceBytes(repoRoot, expectedHead) {
  const tree = cleanHead(repoRoot, expectedHead);
  const entries = [], files = [];
  const records = git(repoRoot, ['ls-tree', '-rz', '--full-tree', expectedHead], true).toString('utf8').split('\0').filter(Boolean);
  for (const record of records) {
    const match = record.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/);
    if (!match) throw new Error('Source tree contains a symlink, submodule or unsupported entry');
    const [, mode, blob, path] = match; safeSourcePath(path);
    const bytes = git(repoRoot, ['cat-file', 'blob', blob], true);
    const tarMode = mode === '100755' ? 0o755 : 0o644;
    files.push({ path, mode, gitBlob: blob, sha256: hash(bytes), bytes: bytes.length });
    entries.push({ path: `project/${path}`, mode: tarMode, bytes });
  }
  const license = entries.find(entry => entry.path === 'project/LICENSE')?.bytes;
  if (!license || !license.length) throw new Error('Committed LICENSE is required');
  const provenance = { schemaVersion: 1, project: 'ResearchBench', commit: expectedHead, tree, files };
  const instructions = `ResearchBench corresponding source

Original commit: ${expectedHead}
Original Git tree: ${tree}

The project/ directory contains only files tracked by that commit. No Git history
or generated build files are included. PROVENANCE.json lists modes and original
Git blob identities; downloaded assets are pinned in project/scripts/assets-manifest.json.

Rebuild with Node.js 26.11.1, pnpm 11.28.5, Rust 1.98.1, Git and rustup:

  cd project
  git init
  git add .
  git -c commit.gpgsign=false -c user.name='Source rebuild' -c user.email='rebuild@example.invalid' commit -m 'Source archive rebuild'
  rustup toolchain install 1.98.1 --profile minimal --target wasm32-unknown-unknown
  rustup override set 1.98.1
  pnpm install --frozen-lockfile
  pnpm assets:prepare
  pnpm wasm:build
  pnpm build
  pnpm source:prepare --expected-head "$(git rev-parse HEAD)"

Use a fresh checkout/build directory and Rust target. wasm:build installs the
locked wasm-bindgen CLI version 0.2.129. Vite requires a real Git HEAD: the new
local commit deliberately supplies a new build identity. Do not impersonate
the original SHA. A source-equivalent rebuild is not a byte-identical original
release. build/ is the static application. pnpm verify runs the local checks.
Run source:prepare again after any subsequent build, which clears build/.

See project/LICENSE and project/THIRD_PARTY_NOTICES.md for rights, upstream
licensing, attribution and the separately replaceable LGPL audio encoder.
`;
  entries.push({ path: 'PROVENANCE.json', mode: 0o644, bytes: Buffer.from(json(provenance)) }, { path: 'REBUILD.txt', mode: 0o644, bytes: Buffer.from(instructions) });
  cleanHead(repoRoot, expectedHead);
  return { archive: encodeArchive(entries), license, provenance };
}
async function regular(path) { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Source offer must be a regular file'); return readFile(path); }
function inventoryTree(files) {
  const root = new Map();
  for (const file of files) {
    safeSourcePath(file.path);
    let directory = root; const parts = file.path.split('/');
    for (const part of parts.slice(0, -1)) {
      if (!directory.has(part)) directory.set(part, new Map());
      directory = directory.get(part);
      if (!(directory instanceof Map)) throw new Error('Conflicting source paths');
    }
    if (directory.has(parts.at(-1))) throw new Error('Duplicate source path');
    directory.set(parts.at(-1), file);
  }
  function tree(directory) {
    const entries = [...directory.entries()].sort(([a, av], [b, bv]) => {
      const left = a + (av instanceof Map ? '/' : ''), right = b + (bv instanceof Map ? '/' : '');
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const bytes = Buffer.concat(entries.map(([name, value]) => Buffer.concat([
      Buffer.from(`${value instanceof Map ? '40000' : value.mode} ${name}\0`),
      Buffer.from(value instanceof Map ? tree(value) : value.gitBlob, 'hex')
    ])));
    return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
  }
  return tree(root);
}
/** @param {{ buildDir: string, expectedHead: string, repoRoot?: string }} options */
export async function verifySourceOffer({ buildDir, expectedHead, repoRoot }) {
  const names = sourceOfferNames(expectedHead), directory = join(buildDir, 'source');
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Unsafe source output directory');
  const actualNames = (await readdir(directory)).sort();
  if (json(actualNames) !== json(Object.values(names).sort())) throw new Error('Unexpected source offer inventory');
  const archive = await regular(join(directory, names.archive)), license = await regular(join(directory, names.license));
  const entries = decodeSourceArchive(archive), provenanceEntry = entries.find(entry => entry.path === 'PROVENANCE.json');
  if (!provenanceEntry) throw new Error('Missing source provenance');
  const provenance = JSON.parse(provenanceEntry.bytes.toString('utf8'));
  if (provenance.schemaVersion !== 1 || provenance.commit !== expectedHead || !sha(provenance.tree) || !Array.isArray(provenance.files)) throw new Error('Source offer provenance mismatch');
  const project = entries.filter(entry => entry.path.startsWith('project/'));
  if (entries.length !== project.length + 2 || !entries.some(entry => entry.path === 'REBUILD.txt') || project.length !== provenance.files.length) throw new Error('Unexpected source archive members');
  for (let index = 0; index < project.length; index++) {
    const entry = project[index], file = provenance.files[index];
    if (entry.path !== `project/${file.path}` || file.bytes !== entry.bytes.length || file.sha256 !== hash(entry.bytes) || file.mode !== (entry.mode === 0o755 ? '100755' : '100644') || file.gitBlob !== createHash('sha1').update(`blob ${entry.bytes.length}\0`).update(entry.bytes).digest('hex')) throw new Error('Source archive inventory mismatch');
  }
  if (inventoryTree(provenance.files) !== provenance.tree) throw new Error('Source archive Git tree mismatch');
  if (!license.equals(project.find(entry => entry.path === 'project/LICENSE')?.bytes ?? Buffer.alloc(0))) throw new Error('Source license differs from archived LICENSE');
  if (repoRoot) { const exact = await sourceBytes(repoRoot, expectedHead); if (!archive.equals(exact.archive) || !license.equals(exact.license)) throw new Error('Source offer differs from exact committed source'); }
  return { head: expectedHead, tree: provenance.tree, files: project.length, archiveSha256: hash(archive) };
}
/** @param {{ repoRoot?: string, buildDir?: string, expectedHead: string }} options */
export async function prepareSourceOffer({ repoRoot = root, buildDir = join(repoRoot, 'build'), expectedHead }) {
  const names = sourceOfferNames(expectedHead);
  const buildStat = await lstat(buildDir); if (!buildStat.isDirectory() || buildStat.isSymbolicLink()) throw new Error('Unsafe build directory');
  const version = JSON.parse(await regular(join(buildDir, '_app/version.json')))?.version;
  const packageVersion = JSON.parse(await regular(join(repoRoot, 'package.json')))?.version;
  if (version !== `${packageVersion}+${expectedHead}`) throw new Error('Source offer compiled build identity mismatch');
  const value = await sourceBytes(repoRoot, expectedHead), directory = join(buildDir, 'source');
  await mkdir(directory, { recursive: true });
  const stat = await lstat(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe source output directory');
  for (const [key, bytes] of [['archive', value.archive], ['license', value.license]]) {
    const path = join(directory, names[key]);
    try { if (!(await regular(path)).equals(bytes)) throw new Error('Existing source offer differs'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(path, bytes, { flag: 'wx', mode: 0o644 }); }
  }
  return verifySourceOffer({ buildDir, expectedHead, repoRoot });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); let expectedHead;
  if (args.length === 2 && args[0] === '--expected-head') expectedHead = args[1];
  else throw new Error('Usage: node scripts/source-offer.mjs --expected-head FULL_SHA');
  console.log(JSON.stringify(await prepareSourceOffer({ expectedHead })));
}
