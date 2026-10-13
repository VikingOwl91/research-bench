import { test, expect, type Page, type Worker, chromium, firefox } from '@playwright/test';
import { readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { Mp3Encoder } from '@breezystack/lamejs';
import { serveBuild } from '../../scripts/serve-build.mjs';
import { modelBasePath } from '../../scripts/model-assets.mjs';
import manifest from '../../scripts/assets-manifest.json' with { type: 'json' };
import { installWasmProbe } from './wasm-probe';

const modelPath = `${modelBasePath(manifest)}multilingual-e5-small/onnx/model_quantized.onnx`;
const fixture = (name: string) => resolve('tests/fixtures', name);
const probePrefix = Buffer.from(`(${installWasmProbe.toString()})();\nself.addEventListener('message', event => { if (event.data?.kind === 'finish') self.postMessage({ __securityProbe: { wasm: self.__securityWasm, violations: self.__securityViolations } }); });\n`);
const workerPath = (path: string) => /\/workers\/(pipeline|encoder)\.worker-[\w-]+\.js$/.test(path);

async function ready(page: Page, origin: string) {
  await page.goto(origin); await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}
async function upload(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }> | string[]) {
  await page.locator('#source-upload').setInputFiles(files);
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
}
function watch(page: Page, origin: string) {
  const counts = { errors: 0, external: 0 };
  page.on('pageerror', () => { counts.errors++; });
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) counts.external++; });
  return counts;
}
async function probeCounts(page: Page) {
  return page.evaluate(() => ({ ...((globalThis as unknown as { __securityWasm: object }).__securityWasm), violations: (globalThis as unknown as { __securityViolations: number }).__securityViolations }));
}

for (const instrumented of [true, false]) test(`strict-CSP PDF/MD/TXT, cold/warm search, cancellation and retry (${instrumented ? 'instrumented contexts' : 'unmodified production bytes'})`, async ({ page }, info) => {
  let modelGets = 0;
  const server = await serveBuild({ port: 0, onRequest(path: string, method?: string) { if (method === 'GET' && path === modelPath) modelGets++; },
    ...(instrumented ? { transformPath: workerPath, transform: (_path: string, bytes: Buffer) => Buffer.concat([probePrefix, bytes]) } : {}) });
  const counts = watch(page, server.origin);
  const workers: Worker[] = []; page.on('worker', worker => { workers.push(worker); });
  await page.addInitScript(installWasmProbe);
  let first = true;
  await page.route(`**${modelPath}`, async route => { if (first) { first = false; await route.abort('failed'); } else await route.continue(); });
  try {
    await ready(page, server.origin);
    await upload(page, [fixture('02-wasserlabor.pdf')]);
    await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('.source-open')).toHaveCount(0);
    await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
    await upload(page, [fixture('02-wasserlabor.pdf')]);
    await expect(page.locator('.source-open')).toHaveCount(1);
    await upload(page, [{ name: 'probe.md', mimeType: 'text/markdown', buffer: Buffer.from('# Storage\nSamples are kept at four degrees Celsius.') },
      { name: 'probe.txt', mimeType: 'text/plain', buffer: Buffer.from('The laboratory opens at nine in the morning.') }]);
    await expect(page.locator('.source-open')).toHaveCount(3);
    await page.getByRole('button', { name: 'Local search', exact: true }).click();
    await page.locator('#question').fill('What is the nitrate concentration?'); await page.locator('#question').press('Enter');
    await expect(page.locator('.search-result').first()).toContainText('17 Milligramm');
    if (instrumented) {
      const live = workers.at(-1)!;
      // Evaluate only the safe counter objects, never the worker's application state.
      const safe = await live.evaluate(() => ({ wasm: (globalThis as unknown as { __securityWasm: object }).__securityWasm, violations: (globalThis as unknown as { __securityViolations: number }).__securityViolations }));
      const wasm = safe.wasm as { rust: number; pdfium: number; onnx: number };
      expect(wasm.rust).toBeGreaterThan(0); expect(wasm.pdfium).toBeGreaterThan(0); expect(wasm.onnx).toBeGreaterThan(0);
      expect(safe.violations).toBe(0); expect(await probeCounts(page)).toMatchObject({ calls: 0, violations: 0 });
      await info.attach('safe-wasm-counters', { body: JSON.stringify(safe), contentType: 'application/json' });
    }
    const before = modelGets;
    await page.reload(); await expect(page.locator('.source-open')).toHaveCount(3);
    await page.getByRole('button', { name: 'Local search', exact: true }).click();
    await page.locator('#question').fill('When does the laboratory open?'); await page.locator('#question').press('Enter');
    await expect(page.locator('.search-result').first()).toContainText('nine'); expect(modelGets).toBe(before);
    await page.unroute(`**${modelPath}`);
    // Clear only this isolated origin's model cache and hold the next cold download.
    await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
    await page.reload(); await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    let held = false, release!: () => void; const gate = new Promise<void>(accept => { release = accept; });
    await page.route(`**${modelPath}`, async route => { held = true; await gate; await route.continue().catch(() => {}); });
    await page.locator('#source-upload').setInputFiles([{ name: 'canceled.txt', mimeType: 'text/plain', buffer: Buffer.from('Canceled documents must never publish.') }]);
    await expect.poll(() => held).toBe(true);
    await page.locator('.progress-banner').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#source-upload')).toBeEnabled(); await expect(page.locator('.source-open')).toHaveCount(3);
    release(); await page.unroute(`**${modelPath}`);
    await upload(page, [{ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('Successfully retried import after cancellation.') }]);
    await expect(page.locator('.source-open')).toHaveCount(4);
    expect(counts).toEqual({ errors: 0, external: 0 });
    expect(await probeCounts(page)).toMatchObject({ calls: 0, violations: 0 });
  } finally { await page.close(); await server.close(); }
});

function tone(rate = 48000, seconds = 0.4) {
  const samples = new Int16Array(Math.round(rate * seconds));
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 2000);
  return samples;
}
function wav() {
  const samples = tone(); const bytes = Buffer.alloc(44 + samples.byteLength);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples.byteLength, 40); Buffer.from(samples.buffer).copy(bytes, 44); return bytes;
}
function mp3() {
  const encoder = new Mp3Encoder(1, 48000, 64), samples = tone(); const parts: Buffer[] = [];
  for (let i = 0; i < samples.length; i += 1152) parts.push(Buffer.from(encoder.encodeBuffer(samples.subarray(i, i + 1152))));
  parts.push(Buffer.from(encoder.flush())); return Buffer.concat(parts);
}

for (const instrumented of [true, false]) test(`real WAV/PCM/MP3 decode, native resampling and production encoder (${instrumented ? 'instrumented' : 'unmodified bytes'})`, async ({ page }, info) => {
  const output = resolve('.cache/security-fixtures/audio'); await mkdir(output, { recursive: true });
  await build({ configFile: false, logLevel: 'silent', build: { outDir: output, emptyOutDir: true, lib: { entry: resolve('tests/security/audio-entry.ts'), formats: ['es'], fileName: () => 'audio-engine.js' } } });
  const files = await readdir(resolve('build/_app/immutable/workers'));
  const encoder = `/_app/immutable/workers/${files.find(file => /^encoder\.worker-.*\.js$/.test(file))!}`;
  const server = await serveBuild({ port: 0, extraFiles: new Map([['/__security__/audio-engine.js', resolve(output, 'audio-engine.js')]]),
    ...(instrumented ? { transformPath: workerPath, transform: (_path: string, bytes: Buffer) => Buffer.concat([probePrefix, bytes]) } : {}) });
  const counts = watch(page, server.origin);
  await page.addInitScript(installWasmProbe);
  try {
    await ready(page, server.origin);
    const result = await page.evaluate(async ({ encoder, wav, raw, mp3 }) => {
      const path = '/__security__/audio-engine.js'; const { PodcastAudioEngine } = await import(/* @vite-ignore */ path);
      let encoderCounts: { wasm: { calls: number }; violations: number } | null = null;
      const engine = new PodcastAudioEngine(() => {
        const worker = new Worker(encoder, { type: 'module' });
        worker.addEventListener('message', event => { if (event.data.__securityProbe) encoderCounts = event.data.__securityProbe; });
        return worker;
      });
      const input = [
        { blob: new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), mimeType: 'audio/wav' },
        { blob: new Blob([new Uint8Array(raw)], { type: 'audio/pcm' }), mimeType: 'audio/pcm', pcmFormat: { channels: 1, sampleRate: 48000, encoding: 's16le' } },
        { blob: new Blob([new Uint8Array(mp3)], { type: 'audio/mpeg' }), mimeType: 'audio/mpeg' }
      ];
      const signal = new AbortController().signal;
      const segments = [];
      for (let i = 0; i < input.length; i++) segments.push(await engine.prepare(`T${i + 1}`, input[i], signal));
      const rendered = await engine.render(segments, { provider: 'mistral', model: 'fixture', voices: { A: { id: 'a', slug: 'a' }, B: { id: 'b', slug: 'b' } }, format: 'wav', pauseMs: 180, encoderVersion: 'lamejs-1.2.7:mono24k:64k:v1', loudness: 'speech-rms-v1' }, signal);
      const blobUrl = URL.createObjectURL(rendered.blob); const audio = document.createElement('audio'); audio.src = blobUrl; document.body.append(audio);
      await new Promise<void>((accept, reject) => { audio.onloadedmetadata = () => accept(); audio.onerror = () => reject(new Error('Generated MP3 did not decode')); });
      const duration = audio.duration; audio.currentTime = 0.1; await audio.play(); await new Promise(accept => setTimeout(accept, 120)); const playing = !audio.paused; audio.pause();
      URL.revokeObjectURL(blobUrl);
      return { encoderCounts, duration, playing, bytes: rendered.blob.size, timeline: rendered.timeline, sampleRates: segments.map((segment: { sampleRate: number }) => segment.sampleRate), peak: rendered.peakBufferBytes, encodingMs: rendered.encodingMs };
    }, { encoder, wav: [...wav()], raw: [...Buffer.from(tone().buffer)], mp3: [...mp3()] });
    expect(result.bytes).toBeGreaterThan(1000); expect(result.duration).toBeGreaterThan(1); expect(result.playing).toBe(true); expect(result.sampleRates).toEqual([24000, 24000, 24000]);
    expect(result.timeline).toHaveLength(3); expect(result.timeline[1].start).toBeGreaterThan(result.timeline[0].end); expect(result.peak).toBeLessThan(128 * 1024 * 1024); expect(result.encodingMs).toBeLessThan(30_000);
    if (instrumented) expect(result.encoderCounts).toMatchObject({ wasm: { calls: 0 }, violations: 0 });
    expect(await probeCounts(page)).toMatchObject({ calls: 0, violations: 0 }); expect(counts).toEqual({ errors: 0, external: 0 });
    await info.attach('safe-audio-counters', { body: JSON.stringify(result), contentType: 'application/json' });
  } finally { await page.close(); await server.close(); }
});

test('versioned 118-MB model reuses browser HTTP cache with a 1-GiB cache budget, independently of CacheStorage', async ({ browserName }) => {
  // Use a temporary-filesystem profile: a large home disk can mask an ignored budget.
  const profile = await mkdtemp(resolve(tmpdir(), 'researchbench-http-cache-profile-'));
  const context = await (browserName === 'chromium' ? chromium : firefox).launchPersistentContext(profile, {
    headless: true, serviceWorkers: 'block',
    // Full Chromium honors this signed-integer preference; headless shell ignores it.
    ...(browserName === 'chromium' ? { channel: 'chromium', args: ['--disk-cache-size=1073741824'] } : { firefoxUserPrefs: { 'browser.cache.disk.capacity': 1048576, 'browser.cache.disk.smart_size.enabled': false, 'browser.cache.disk.max_entry_size': -1 } })
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.addInitScript(installWasmProbe);
  let gets = 0;
  const server = await serveBuild({ port: 0, onRequest(path: string, method?: string) { if (path === modelPath && method === 'GET') gets++; } });
  const counts = watch(page, server.origin);
  try {
    await ready(page, server.origin);
    const lengths = await page.evaluate(async path => {
      const first = await fetch(path); if (!first.ok || first.headers.get('cache-control') !== 'public, max-age=31536000, immutable') throw new Error('Model cache policy differs');
      const a = (await first.arrayBuffer()).byteLength;
      for (const key of await caches.keys()) await caches.delete(key);
      const b = (await (await fetch(path)).arrayBuffer()).byteLength;
      return [a, b];
    }, modelPath);
    expect(lengths).toEqual([118308185, 118308185]); expect(gets).toBe(1);
    await page.reload(); await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    expect(await page.evaluate(async path => (await (await fetch(path)).arrayBuffer()).byteLength, modelPath)).toBe(118308185); expect(gets).toBe(1);
    expect(counts).toEqual({ errors: 0, external: 0 });
    expect(await probeCounts(page)).toMatchObject({ calls: 0, violations: 0 });
  } finally { await context.close(); await server.close(); await rm(profile, { recursive: true, force: true }); }
});
