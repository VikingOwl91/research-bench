#!/usr/bin/env node
// Public, credential-free hosting acceptance. Responses are hashed as streams;
// neither provider/document bodies nor arbitrary headers are printed.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { isImmutablePath, validateSecurityHeaders, validateDocumentPolicy } from './hosting-policy.mjs';

const args = process.argv.slice(2);
let url, releasePath, localRehearsal = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--url' && args[i + 1]) url = args[++i];
  else if (args[i] === '--release' && args[i + 1]) releasePath = resolve(args[++i]);
  else if (args[i] === '--local-rehearsal') localRehearsal = true;
  else throw new Error('Usage: node scripts/check-hosting.mjs [--url HTTPS_ORIGIN] --release RELEASE_DIR [--local-rehearsal]');
}
if (!url) throw new Error('--url is required; specify the HTTPS origin to verify.');
const target = new URL(url);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
if (target.username || target.password || target.pathname !== '/' || target.search || target.hash || (target.protocol !== 'https:' && !(localRehearsal && loopback && target.protocol === 'http:'))) throw new Error('Target must be an HTTPS origin; HTTP requires --local-rehearsal and an explicit loopback origin.');
if (localRehearsal && !loopback) throw new Error('--local-rehearsal is restricted to loopback.');
if (!releasePath) throw new Error('--release is required to identify the exact deployed artifact.');
const manifestBytes = await readFile(join(releasePath, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid release manifest.');
const paths = new Set();
for (const file of manifest.files) {
  if (typeof file.path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some(part => part === '..' || part === '.' || !part) || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Unsafe or invalid release manifest entry.');
  paths.add(file.path);
}
const index = manifest.files.find(file => file.path === 'index.html');
if (!index) throw new Error('Release must contain index.html.');
const artifact = createHash('sha256').update(manifestBytes).digest('hex');
const failures = [];
let assertions = 0, downloadedBytes = 0;
function check(condition, label) { assertions++; if (!condition) failures.push(label); }
function cachePolicy(response, path) {
  const cache = response.headers.get('cache-control') ?? '';
  check(isImmutablePath(path) ? /\bimmutable\b/.test(cache) && /max-age=[1-9]\d*/.test(cache) : /\bno-cache\b/.test(cache), `${path}: cache policy`);
}
function securityPolicy(response, path) {
  try { validateSecurityHeaders(response.headers, path, { https: target.protocol === 'https:', origin: target.origin }); check(true, `${path}: security headers and effective CSP`); }
  catch (error) { check(false, `${path}: ${error.message}`); }
}
function documentPolicy(response, html, path) {
  try { validateDocumentPolicy(html, response.headers.get('content-security-policy'), { origin: target.origin }); check(true, `${path}: early meta, bootstrap hashes and effective document CSP`); }
  catch (error) { check(false, `${path}: ${error.message}`); }
}
function mimePolicy(response, path) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (path.endsWith('.wasm')) check(type === 'application/wasm', `${path}: WASM MIME`);
  else if (/\.(?:js|mjs)$/.test(path)) check(['text/javascript', 'application/javascript'].includes(type), `${path}: JavaScript MIME`);
  else if (path.endsWith('.json')) check(type === 'application/json', `${path}: JSON MIME`);
  else if (path.endsWith('.html')) check(type === 'text/html', `${path}: HTML MIME`);
  else check(type !== 'text/html', `${path}: asset unexpectedly returned HTML`);
}
async function get(path, method = 'GET', base = target) {
  return fetch(new URL(path, base), { method, redirect: 'manual', signal: AbortSignal.timeout(120_000), headers: { 'accept-encoding': 'identity' } });
}
async function hash(response, captureHtml = false) {
  const chunks = [];
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of response.body ?? []) { hash.update(chunk); bytes += chunk.length; if (captureHtml) { if (bytes > 1_048_576) throw new Error('Unexpectedly large release HTML.'); chunks.push(chunk); } }
  downloadedBytes += bytes;
  return { sha256: hash.digest('hex'), bytes, html: captureHtml ? Buffer.concat(chunks).toString('utf8') : undefined };
}

if (!localRehearsal) {
  const httpOrigin = new URL(target); httpOrigin.protocol = 'http:';
  const response = await get('/', 'GET', httpOrigin);
  check([301, 302, 307, 308].includes(response.status), 'HTTP root redirects');
  check(response.headers.get('location') === `${target.origin}/`, 'HTTP redirect targets exact HTTPS origin');
  await response.body?.cancel();
}
// Successful HTTPS fetch uses Node's normal certificate trust and hostname
// validation. There is no insecure-TLS escape hatch.
for (const file of manifest.files) {
  const path = `/${file.path}`;
  const head = await get(path, 'HEAD');
  check(head.status === 200, `${file.path}: HEAD status ${head.status}`);
  mimePolicy(head, file.path); cachePolicy(head, file.path); securityPolicy(head, file.path);
  const getResponse = await get(path);
  check(getResponse.status === 200, `${file.path}: GET status ${getResponse.status}`);
  mimePolicy(getResponse, file.path); cachePolicy(getResponse, file.path); securityPolicy(getResponse, file.path);
  const actual = await hash(getResponse, file.path.endsWith('.html'));
  if (actual.html !== undefined) documentPolicy(getResponse, actual.html, file.path);
  check(actual.bytes === file.bytes, `${file.path}: byte count differs from manifest`);
  check(actual.sha256 === file.sha256, `${file.path}: SHA-256 differs from manifest`);
}
for (const path of ['/', '/?hosting-check=1', '/__researchbench_navigation_probe']) {
  const response = await get(path);
  check(response.status === 200, `${path}: navigation status ${response.status}`);
  mimePolicy(response, 'index.html'); cachePolicy(response, 'index.html'); securityPolicy(response, 'index.html');
  const actual = await hash(response, true);
  documentPolicy(response, actual.html, path);
  check(actual.sha256 === index.sha256, `${path}: navigation does not return release index`);
}
for (const path of ['/_app/immutable/missing-hosting-probe.js', '/pdfium/missing-hosting-probe.wasm', '/models/missing-hosting-probe.json', '/runtime/missing-hosting-probe.mjs', '/notices/missing-hosting-probe.txt', '/missing-hosting-probe.js']) {
  const response = await get(path);
  check(response.status === 404, `${path}: missing asset status ${response.status}`);
  check(response.headers.get('content-type')?.split(';')[0] !== 'text/html', `${path}: missing asset has HTML fallback`);
  await response.body?.cancel();
}
console.log(`Artifact ${artifact}: ${manifest.files.length} files, ${downloadedBytes} decoded bytes, ${assertions} assertions.`);
console.log(localRehearsal ? 'Loopback rehearsal: public TLS, HTTP redirect and external reachability are not covered.' : 'HTTPS certificate and hostname validation enabled; HTTP redirect checked.');
if (failures.length) { for (const failure of failures) console.error(`FAIL ${failure}`); process.exitCode = 1; }
else console.log('PASS hosting bytes, MIME types, cache/security headers and effective CSP, SPA navigation and missing-asset 404s.');
