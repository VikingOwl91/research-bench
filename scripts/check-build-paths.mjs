import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const homePath = /(?:\/home\/|\/Users\/|[A-Za-z]:[\\/]Users[\\/])[^\x00\s"'<>`;,{}()\[\]]{1,4096}/g;
const cargoPath = /(?:[A-Za-z]:[\\/]|\/)[^\x00\r\n"'<>`;,{}()\[\]]{0,4096}?[\\/]registry[\\/](?:src|cache)[\\/][^\x00\s"'<>`;,{}()\[\]]{1,4096}/g;

// Emscripten's synthetic filesystem HOME, present in pinned Pdfium/ONNX JS.
// This literal is not a directory on the machine compiling ResearchBench.
const virtualHome = '/home/web_user';

export function inspectPathBytes(bytes, prefixes = []) {
  const text = bytes.toString('latin1');
  const findings = [];
  const neutralCargo = [];
  const virtualHomes = [];
  for (const match of text.matchAll(homePath)) {
    if (match[0] === virtualHome) virtualHomes.push(match.index);
    else findings.push({ offset: match.index, kind: 'absolute-home-path' });
  }
  for (const match of text.matchAll(cargoPath)) {
    if (match[0].startsWith('/cargo/registry/')) neutralCargo.push(match.index);
    else findings.push({ offset: match.index, kind: 'absolute-cargo-path' });
  }
  for (const prefix of prefixes) {
    const value = Buffer.from(prefix);
    if (value.length < 2) continue;
    let at = -1;
    while ((at = bytes.indexOf(value, at + 1)) !== -1) findings.push({ offset: at, kind: 'build-location-prefix' });
  }
  return { findings, neutralCargo, virtualHomes };
}

async function pathsUnder(directory, relative = '') {
  const stat = await lstat(join(directory, relative));
  if (stat.isSymbolicLink()) throw new Error('Build path scan rejects symlinks');
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) throw new Error('Build path scan requires regular files');
  const paths = [];
  for (const name of (await readdir(join(directory, relative))).sort()) {
    paths.push(...await pathsUnder(directory, relative ? `${relative}/${name}` : name));
  }
  return paths;
}

export async function checkBuildPaths({ buildDir = resolve(root, 'build'), generatedWasm = resolve(root, 'src/lib/wasm/research_core_bg.wasm'), prefixes = [] } = {}) {
  const files = await pathsUnder(buildDir);
  const wasmFiles = files.filter(path => /(?:^|\/)research_core_bg[^/]*\.wasm$/.test(path));
  if (wasmFiles.length !== 1 || !/^_app\/immutable\/workers\/assets\/research_core_bg-[A-Za-z0-9_-]+\.wasm$/.test(wasmFiles[0])) {
    throw new Error('Expected exactly one hashed distributed research_core WASM');
  }
  const generatedStat = await lstat(generatedWasm);
  if (!generatedStat.isFile() || generatedStat.isSymbolicLink()) throw new Error('Expected a regular generated WASM');
  const generated = await readFile(generatedWasm);
  const wasm = await readFile(join(buildDir, wasmFiles[0]));
  if (!WebAssembly.validate(wasm) || !wasm.equals(generated)) throw new Error('Distributed WASM is invalid or differs from generated WASM');
  const locations = [root, homedir(), resolve(root, process.env.CARGO_HOME ?? join(homedir(), '.cargo')),
    ...(process.env.CARGO_TARGET_DIR ? [resolve(root, process.env.CARGO_TARGET_DIR)] : []), ...prefixes];
  for (const path of [...locations]) {
    try { locations.push(await realpath(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const identifying = [...new Set(locations)].filter(path => path.length > 1);
  const findings = new Map(), neutral = new Set(), virtual = new Set();
  let bytesScanned = 0;
  // Keep enough overlap for paths split across stream chunks, without decoding
  // entire model binaries into JavaScript strings.
  const overlap = Math.max(8192, ...identifying.map(path => Buffer.byteLength(path) + 16));
  for (const file of files) {
    let tail = Buffer.alloc(0), position = 0;
    for await (const chunk of createReadStream(join(buildDir, file), { highWaterMark: 1024 * 1024 })) {
      const buffer = Buffer.concat([tail, chunk]);
      const start = position - tail.length;
      const result = inspectPathBytes(buffer, identifying);
      for (const finding of result.findings) {
        const item = { file, offset: start + finding.offset, kind: finding.kind };
        findings.set(`${file}:${item.offset}:${item.kind}`, item);
      }
      for (const offset of result.neutralCargo) neutral.add(`${file}:${start + offset}`);
      for (const offset of result.virtualHomes) virtual.add(`${file}:${start + offset}`);
      position += chunk.length;
      bytesScanned += chunk.length;
      tail = buffer.subarray(Math.max(0, buffer.length - overlap));
    }
  }
  return { filesScanned: files.length, bytesScanned, wasmFile: wasmFiles[0], wasmBytes: wasm.length,
    wasmSha256: createHash('sha256').update(wasm).digest('hex'), neutralCargoPaths: neutral.size,
    virtualRuntimeHomes: virtual.size, findings: [...findings.values()] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 4) throw new Error('Usage: node scripts/check-build-paths.mjs [build-directory [generated-WASM]]');
    const result = await checkBuildPaths({ ...(process.argv[2] ? { buildDir: resolve(process.argv[2]) } : {}),
      ...(process.argv[3] ? { generatedWasm: resolve(process.argv[3]) } : {}) });
    console.log(JSON.stringify(result));
    if (result.findings.length) process.exitCode = 1;
  } catch (error) {
    // Filesystem errors may include identifying absolute paths: never print them.
    console.error(error.code ? `Build path verification failed (${error.code})` : error.message);
    process.exitCode = 1;
  }
}
