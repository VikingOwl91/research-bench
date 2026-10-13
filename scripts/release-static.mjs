#!/usr/bin/env node
/** Local, content-addressed snapshots. No SSH, network access, or Git mutation. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile, mkdir, mkdtemp, copyFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { physicalAssetPath, modelBasePath } from './model-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function safeRelativePath(path) {
  if (typeof path !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('-'))) {
    throw new Error('Unsafe relative file path');
  }
  return path;
}

async function regular(path, directory = false) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile())) {
    throw new Error(`Expected ${directory ? 'directory' : 'regular file'}: ${path}`);
  }
  return stat;
}

async function hashFile(path) {
  await regular(path);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { sha256: hash.digest('hex'), bytes };
}

export async function createManifest(directory) {
  await regular(directory, true);
  const files = [];
  async function walk(relative = '') {
    const entries = (await readdir(join(directory, relative))).sort(compare);
    for (const name of entries) {
      const path = safeRelativePath(relative ? `${relative}/${name}` : name);
      const absolute = join(directory, path);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Symlink rejected: ${path}`);
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) files.push({ path, ...await hashFile(absolute) });
      else throw new Error(`Nonregular file rejected: ${path}`);
    }
  }
  await walk();
  files.sort((a, b) => compare(a.path, b.path));
  return { schemaVersion: 1, files };
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('Invalid or empty release manifest');
  }
  let previous = '';
  for (const file of manifest.files) {
    safeRelativePath(file.path);
    if (compare(previous, file.path) >= 0 || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Invalid release manifest entry');
    previous = file.path;
  }
}

async function validateBuild(manifest, assetsManifestPath) {
  const pinned = JSON.parse(await readFile(assetsManifestPath, 'utf8'));
  const assets = [...pinned.embedding.files, ...pinned.pdfium.files, ...pinned.runtime.files,
    ...pinned.audioEncoder.files, ...pinned.notices];
  if (assets.length !== 27) throw new Error('Expected all 27 pinned assets');
  const files = new Map(manifest.files.map(file => [file.path, file]));
  const seen = new Set();
  for (const asset of assets) {
    if (!asset.path.startsWith('static/')) throw new Error('Pinned asset is outside static/');
    const path = safeRelativePath(physicalAssetPath(asset, pinned).slice('static/'.length));
    if (seen.has(path)) throw new Error('Duplicate pinned asset');
    seen.add(path);
    const file = files.get(path);
    if (!file || file.bytes !== asset.bytes || file.sha256 !== asset.sha256) throw new Error(`Pinned asset mismatch: ${path}`);
  }
  const modelPrefix = modelBasePath(pinned).slice(1);
  if (manifest.files.some(file => file.path.startsWith('models/') && !file.path.startsWith(modelPrefix))) {
    throw new Error('Unexpected or legacy model directory in release');
  }
  for (const pattern of [/^index\.html$/, /^_app\/immutable\/workers\/pipeline\.worker-[\w-]+\.js$/,
    /^_app\/immutable\/workers\/encoder\.worker-[\w-]+\.js$/,
    /^_app\/immutable\/workers\/assets\/research_core_bg-[\w-]+\.wasm$/]) {
    if (!manifest.files.some(file => pattern.test(file.path))) throw new Error(`Missing built runtime artifact: ${pattern}`);
  }
}

function provenance(repoRoot) {
  const git = args => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '-uno']);
  // Untracked source matters; request only a boolean and never emit path names or diffs.
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return {
    head: head.status === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim()) ? head.stdout.trim() : null,
    dirty: status.status === 0 && untracked.status === 0 ? Boolean(status.stdout || untracked.stdout) : null,
    meaning: 'Informational only. Artifact identity covers built bytes, not the HEAD source tree.'
  };
}

function committedOptions({ requireClean = false, expectedHead } = {}) {
  if (expectedHead !== undefined && !/^[a-f0-9]{40,64}$/.test(expectedHead)) throw new Error('Expected HEAD must be a full Git SHA');
  if (requireClean && !expectedHead) throw new Error('Committed release requires an explicit expected HEAD');
  return { requireClean, expectedHead };
}

function assertCommitted(value, options) {
  if (options.expectedHead && value?.head !== options.expectedHead) throw new Error('Release provenance HEAD mismatch');
  if (options.requireClean && value?.dirty !== false) throw new Error('Committed release requires a verified clean source tree');
}

async function compiledBuildIdentity(directory, expectedVersion) {
  const path = join(directory, '_app/version.json');
  try { await regular(path); }
  catch (error) { if (error.code === 'ENOENT') throw new Error('Missing compiled build version'); throw error; }
  const versionFile = JSON.parse(await readFile(path, 'utf8'));
  if (versionFile?.version !== expectedVersion) throw new Error('Compiled build version differs from committed source identity');
  await regular(join(directory, 'index.html'));
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  const bootstrapVersions = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(script[1])) continue;
    for (const bootstrap of script[2].matchAll(/\b__sveltekit_[A-Za-z0-9_]+\s*=\s*\{[\s\S]*?\bversion\s*:\s*("(?:\\.|[^"\\])*")/g)) {
      bootstrapVersions.push(JSON.parse(bootstrap[1]));
    }
  }
  if (bootstrapVersions.length !== 1 || bootstrapVersions[0] !== expectedVersion) throw new Error('Bootstrap version differs from compiled build identity');
}

export async function verifyRelease(releaseDir, options = {}) {
  options = committedOptions(options);
  await regular(releaseDir, true);
  await regular(join(releaseDir, 'manifest.json'));
  const bytes = await readFile(join(releaseDir, 'manifest.json'));
  const manifest = JSON.parse(bytes.toString('utf8'));
  validateManifest(manifest);
  if (serialize(manifest) !== bytes.toString('utf8')) throw new Error('Noncanonical release manifest');
  const artifactId = digest(bytes);
  if (releaseDir.split(/[\\/]/).filter(Boolean).at(-1) !== artifactId) throw new Error('Release directory does not match artifact ID');
  await regular(join(releaseDir, 'release.json'));
  const metadata = JSON.parse(await readFile(join(releaseDir, 'release.json'), 'utf8'));
  assertCommitted(metadata.provenance, options);
  if (options.requireClean) {
    if (typeof metadata.buildVersion !== 'string' || !metadata.buildVersion.endsWith(`+${options.expectedHead}`) || metadata.buildVersion === `+${options.expectedHead}`) throw new Error('Release metadata build version does not match provenance HEAD');
    await compiledBuildIdentity(join(releaseDir, 'site'), metadata.buildVersion);
  }
  if (metadata.artifactId !== artifactId) throw new Error('Release metadata artifact ID mismatch');
  const actual = await createManifest(join(releaseDir, 'site'));
  if (serialize(actual) !== serialize(manifest)) throw new Error('Release site inventory or bytes mismatch');
  await regular(join(releaseDir, 'SHA256SUMS'));
  const sums = manifest.files.map(file => `${file.sha256}  ${file.path}\n`).join('');
  if (await readFile(join(releaseDir, 'SHA256SUMS'), 'utf8') !== sums) throw new Error('SHA256SUMS mismatch');
  return { artifactId, releaseDir, count: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
}

/** @param {{ buildDir?: string, outputRoot?: string, assetsManifestPath?: string, repoRoot?: string, requireClean?: boolean, expectedHead?: string }} [options] */
export async function prepareRelease({ buildDir = join(root, 'build'), outputRoot = join(root, '.cache/deployment'),
  assetsManifestPath = join(root, 'scripts/assets-manifest.json'), repoRoot = root, requireClean = false, expectedHead } = {}) {
  const options = committedOptions({ requireClean, expectedHead });
  const source = provenance(repoRoot);
  assertCommitted(source, options);
  buildDir = resolve(buildDir); outputRoot = resolve(outputRoot);
  let buildVersion;
  if (requireClean) {
    const sourcePackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    if (typeof sourcePackage.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(sourcePackage.version)) throw new Error('Invalid committed package version');
    buildVersion = `${sourcePackage.version}+${expectedHead}`;
    await compiledBuildIdentity(buildDir, buildVersion);
  }
  if (outputRoot === buildDir || outputRoot.startsWith(`${buildDir}/`)) throw new Error('Release output must be outside build directory');
  const manifest = await createManifest(buildDir);
  validateManifest(manifest);
  await validateBuild(manifest, assetsManifestPath);
  const manifestBytes = serialize(manifest);
  const artifactId = digest(manifestBytes);
  await mkdir(outputRoot, { recursive: true });
  await regular(outputRoot, true);
  const releaseDir = join(outputRoot, artifactId);
  const lock = `${releaseDir}.lock`;
  // Exclusive local preparation lock prevents two writers from replacing the same release.
  await mkdir(lock);
  let temporary;
  try {
    let exists = true;
    try { await lstat(releaseDir); }
    catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
    // A malformed existing snapshot must fail closed, including missing metadata.
    if (exists) {
      const result = await verifyRelease(releaseDir, options);
      assertCommitted(provenance(repoRoot), options);
      return result;
    }
    temporary = await mkdtemp(join(outputRoot, '.preparing-'));
    const site = join(temporary, 'site');
    await mkdir(site);
    for (const file of manifest.files) {
      const source = join(buildDir, file.path);
      await regular(source);
      const target = join(site, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    if (serialize(await createManifest(site)) !== manifestBytes) throw new Error('Build changed while snapshotting');
    // Catch concurrent additions and deletions, too.
    if (serialize(await createManifest(buildDir)) !== manifestBytes) throw new Error('Build changed while snapshotting');
    if (requireClean) await compiledBuildIdentity(site, buildVersion);
    await writeFile(join(temporary, 'manifest.json'), manifestBytes, { flag: 'wx' });
    await writeFile(join(temporary, 'SHA256SUMS'), manifest.files.map(file => `${file.sha256}  ${file.path}\n`).join(''), { flag: 'wx' });
    const finalSource = provenance(repoRoot);
    assertCommitted(finalSource, options);
    if ((options.requireClean || options.expectedHead) && (finalSource.head !== source.head || finalSource.dirty !== source.dirty)) throw new Error('Source changed while snapshotting');
    await writeFile(join(temporary, 'release.json'), serialize({ schemaVersion: 1, artifactId,
      createdAt: new Date().toISOString(), ...(requireClean ? { buildVersion } : {}), provenance: { ...finalSource, meaning: requireClean
        ? 'Source HEAD and clean status verified before and after snapshotting; compiled JSON and bootstrap identities match.'
        : finalSource.meaning } }), { flag: 'wx' });
    await rename(temporary, releaseDir); temporary = undefined;
    return await verifyRelease(releaseDir, options);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}

async function main() {
  const [command = 'prepare', ...raw] = process.argv.slice(2);
  const args = [], options = {};
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--require-clean') { if (options.requireClean) throw new Error('Duplicate --require-clean'); options.requireClean = true; }
    else if (raw[i] === '--expected-head') { if (options.expectedHead !== undefined || !raw[i + 1]) throw new Error('Invalid --expected-head'); options.expectedHead = raw[++i]; }
    else if (raw[i].startsWith('--')) throw new Error('Unknown release option');
    else args.push(raw[i]);
  }
  let result;
  if (command === 'prepare' && args.length <= 2) result = await prepareRelease({ buildDir: args[0], outputRoot: args[1], ...options });
  else if (command === 'verify' && args.length === 1) result = await verifyRelease(resolve(args[0]), options);
  else throw new Error('Usage: node scripts/release-static.mjs prepare [build-dir] [output-root] | verify <release-dir> [--require-clean --expected-head <full-SHA>]');
  console.log(`Artifact: ${result.artifactId}\nRelease: ${result.releaseDir}\nFiles: ${result.count}; bytes: ${result.bytes}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Release preparation failed: ${error.message}`); process.exitCode = 1; });
}
