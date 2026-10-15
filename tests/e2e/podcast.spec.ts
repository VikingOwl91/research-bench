import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Mp3Encoder } from '@breezystack/lamejs';
import { requireAudioBackend } from './audio-backend';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const chatEndpoint = /https:\/\/(?:api\.eu\.mistral\.ai|openrouter\.ai)\/.*chat\/completions/;
const voiceEndpoint = /https:\/\/api\.eu\.mistral\.ai\/v2\/audio\/voices/;
const speechEndpoint = /https:\/\/api\.eu\.mistral\.ai\/v1\/audio\/speech/;
const testKey = 'test-only-podcast-key';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('researchbench:locale', 'de'));
});
// Original synthetic tone, not a real voice. Browser tests exercise real decode and encoder workers.
function wavTone(seconds = 1, rate = 48000) {
  const count = Math.round(rate * seconds);
  const bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 1800), 44 + i * 2);
  return bytes.toString('base64');
}
const audio_data = wavTone();
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeEnabled();
}
async function saveKey(page: Page) {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.locator('input[name="provider"][value="mistral"]').check();
  await page.locator('#api-key').fill(testKey);
  await page.locator('.key-form').getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
}
async function source(page: Page) {
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures/02-wasserlabor.pdf'));
  await expect(page.locator('.source-open').filter({ hasText: '02-wasserlabor.pdf' })).toBeVisible({ timeout: 180000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180000 });
}
async function speech(route: Route) { await route.fulfill({ headers: cors, json: { audio_data } }); }
async function mocks(page: Page, onSpeech: (route: Route) => Promise<void> = speech) {
  await page.route(voiceEndpoint, route => route.fulfill({ headers: cors, json: { data: [{ type: 'preset', slug: 'gb_oliver_curious', id: 'voice-oliver' }, { type: 'preset', slug: 'gb_jane_neutral', id: 'voice-jane' }], next_page_token: null } }));
  await page.route(chatEndpoint, async route => {
    const body = route.request().postDataJSON();
    expect(body.response_format.json_schema.name).toBe('researchbench_podcast');
    const input = JSON.parse(body.messages.at(-1).content);
    const citation = input.sources[0].id;
    const texts = input.language === 'de' ? ['Was erfahren wir über die Wasserprobe?', 'Die Probe enthält 17 Milligramm Nitrat pro Liter.', 'Wir können diese Angabe direkt in der Quelle prüfen.', 'Genau, damit bleibt unser Gespräch nachvollziehbar.'] : ['What do we learn about the water sample?', 'The sample contains 17 milligrams of nitrate per litre.', 'We can check that finding in the source.', 'Yes, that keeps our conversation grounded.'];
    const script = { title: input.language === 'de' ? 'Wasserwissen im Gespräch' : 'Water findings in conversation', language: input.language, turns: texts.map((text, i) => ({ speaker: i % 2 === 0 ? 'A' : 'B', text, citationIds: [citation] })) };
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(script) }, finish_reason: 'stop' }] } });
  });
  await page.route(speechEndpoint, onSpeech);
}
async function podcastTab(page: Page) {
  // After reload the SPA must mount before checking responsive navigation.
  await expect(page.getByRole('heading', { name: 'Raum für neue Erkenntnisse.', exact: true })).toBeVisible();
  const studio = page.getByRole('button', { name: 'Studio', exact: true });
  if (await studio.isVisible()) await studio.click();
  await page.getByRole('button', { name: 'Podcast', exact: true }).click();
}

test('podcast WAV to actual MP3 worker, contribution timeline, download, reload, citations and deletion', async ({ page }) => {
  await requireAudioBackend(page);
  const requests: any[] = [];
  await mocks(page, async route => { const body = route.request().postDataJSON(); requests.push(body); expect(body.response_format).toBe('wav'); expect(body.input).not.toContain('C1'); expect(route.request().headers().authorization).toBe(`Bearer ${testKey}`); await speech(route); });
  await ready(page); await source(page); await saveKey(page); await podcastTab(page);
  await expect(page.locator('#podcast-language')).toHaveValue('en');
  await page.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  const audio = page.getByLabel('Podcast wiedergeben', { exact: true });
  await expect(audio).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.podcast-turn')).toHaveCount(4);
  await expect(page.locator('.podcast-turn').first()).toContainText('What do we learn');
  expect(requests.map(r => r.voice_id)).toEqual(['voice-oliver', 'voice-jane', 'voice-oliver', 'voice-jane']);
  await expect(page.getByLabel('Wiedergabegeschwindigkeit')).toHaveValue('auto');
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration)).toBeGreaterThan(4);
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(1.2);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.preservesPitch)).toBe(true);
  await page.getByRole('button', { name: /Zu Beitrag 3 springen$/ }).click();
  await expect(page.locator('.podcast-turn').nth(2)).toHaveClass(/playing/);
  await page.getByLabel('Wiedergabegeschwindigkeit').selectOption('1.5');
  expect(await audio.evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(1.5);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  const download = page.getByRole('link', { name: 'MP3 herunterladen' });
  await expect(download).toHaveAttribute('href', /^blob:/);
  await page.locator('.podcast-player').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-podcast-player.png`, fullPage: true });
  const downloadEvent = page.waitForEvent('download'); await download.click();
  const downloaded = await downloadEvent;
  expect(downloaded.suggestedFilename()).toBe('researchbench-podcast-en.mp3');
  const bytes = await readFile((await downloaded.path())!);
  expect(bytes.length).toBeGreaterThan(2000);
  expect(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)).toBe(true);
  await page.locator('.podcast-turn .citation').first().click();
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-podcast.png`, fullPage: true });
  await page.reload(); await podcastTab(page); await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible(); expect(requests).toHaveLength(4);
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: 'Studio', exact: true }).click();
  await expect(page.getByRole('link', { name: 'MP3 herunterladen' })).toBeVisible();
  await page.locator('.podcast-player').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-podcast-mobile.png`, fullPage: true });
  await page.getByRole('button', { name: 'Gespeicherte Folge löschen', exact: true }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toHaveCount(0);
  await page.reload(); await podcastTab(page); await expect(page.locator('.podcast-turn')).toHaveCount(0);
});

test('fictitious DE/EN voice probes need no documents and remain separate from persisted episodes', async ({ page }) => {
  const spoken: string[] = [];
  await mocks(page, async route => { spoken.push(route.request().postDataJSON().input); await speech(route); });
  await ready(page); await saveKey(page); await podcastTab(page);
  await expect(page.locator('#podcast-language')).toHaveValue('en');
  for (const language of ['en', 'de']) {
    await page.locator('#podcast-language').selectOption(language);
    if (language === 'de') {
      await expect(page.locator('#podcast-language option[value="de"]')).toHaveText('Deutsch (experimentell)');
      await expect(page.locator('.podcast-content .stale-note')).toContainText('Deutsch ist experimentell');
    } else {
      await expect(page.locator('.podcast-content .stale-note')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Stimmen testen', exact: true }).click();
    await expect(page.getByLabel('Stimmprobe', { exact: true })).toBeVisible({ timeout: 60000 });
    await page.getByLabel('Stimmprobe', { exact: true }).evaluate((element: HTMLAudioElement) => element.play());
    await expect.poll(() => page.getByLabel('Stimmprobe', { exact: true }).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
    await expect.poll(() => page.getByLabel('Stimmprobe', { exact: true }).evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(language === 'de' ? 1.3 : 1.2);
    expect(await page.getByLabel('Stimmprobe', { exact: true }).evaluate((element: HTMLAudioElement) => element.preservesPitch)).toBe(true);
    await page.getByLabel('Stimmprobe', { exact: true }).evaluate((element: HTMLAudioElement) => { element.pause(); element.currentTime = 1.5; element.dispatchEvent(new Event('seeked')); });
    expect(await page.getByLabel('Stimmprobe', { exact: true }).evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(language === 'de' ? 1.3 : 1);
  }
  expect(spoken.length).toBeGreaterThanOrEqual(4);
  await expect(page.locator('.podcast-turn')).toHaveCount(0);
  await page.reload(); await podcastTab(page); await expect(page.getByLabel('Stimmprobe', { exact: true })).toHaveCount(0);
});

test('removing key mid-TTS preserves segments, reload and explicit resume only generate missing contributions', async ({ page }) => {
  let calls = 0;
  let pending: Route | undefined;
  let block = true;
  await mocks(page, async route => { calls++; if (calls === 2 && block) pending = route; else await speech(route); });
  await ready(page); await source(page); await saveKey(page); await podcastTab(page);
  await page.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gespeicherten Key entfernen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Gespeicherten Key entfernen', exact: true }).click();
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.locator('.podcast-draft')).toContainText('1 Audioabschnitt ist gespeichert.');
  await expect(page.getByRole('button', { name: 'Fortsetzen', exact: true })).toBeDisabled();
  if (pending) await speech(pending).catch(() => {}); // Abort was already delivered; this late response must not create another segment.
  await page.reload(); await podcastTab(page);
  await expect(page.locator('.podcast-draft')).toContainText('1 Audioabschnitt ist gespeichert.');
  block = false; await saveKey(page);
  await page.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible({ timeout: 60000 });
  expect(calls).toBe(5); // first completed + first canceled attempt + remaining three
  await expect(page.locator('.podcast-draft')).toHaveCount(0);
});

test('without Web Locks generation is unavailable while settings stay accessible', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  await ready(page); await saveKey(page); await podcastTab(page);
  await expect(page.locator('.podcast-content')).toContainText('parallele Podcast-Aufträge');
  await expect(page.getByRole('button', { name: 'Podcast erstellen', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Stimmen testen', exact: true })).toBeDisabled();
});

function mp3Tone() {
  const encoder = new Mp3Encoder(1, 48000, 64);
  const samples = new Int16Array(48000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(2 * Math.PI * 220 * i / 48000) * 1800);
  const chunks: Buffer[] = [];
  for (let i = 0; i < samples.length; i += 1152) chunks.push(Buffer.from(encoder.encodeBuffer(samples.subarray(i, i + 1152))));
  chunks.push(Buffer.from(encoder.flush()));
  return Buffer.concat(chunks);
}
async function artifactTelemetry(page: Page) {
  return page.evaluate(async () => new Promise<Array<{ kind: string; status?: string; durationSeconds?: number; encodingMs?: number; peakBufferBytes?: number; timeline?: Array<{turnId: string; start: number; end: number}> }>>((resolve, reject) => {
    const request = indexedDB.open('researchbench-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('artifacts', 'readonly');
      const rows = tx.objectStore('artifacts').getAll();
      rows.onsuccess = () => resolve(rows.result.map(({ kind, status, durationSeconds, encodingMs, peakBufferBytes, timeline }) => ({ kind, status, durationSeconds, encodingMs, peakBufferBytes, timeline })));
      rows.onerror = () => reject(rows.error);
      tx.oncomplete = () => db.close();
    };
  }));
}

test('OpenRouter actual MP3 decode and resample, stale ready episode, and saved playback without Web Locks', async ({ page }) => {
  await requireAudioBackend(page);
  const rawMp3 = mp3Tone();
  let speechCalls = 0;
  await mocks(page);
  await page.route(/https:\/\/openrouter\.ai\/api\/v1\/models/, route => route.fulfill({ headers: cors, json: { data: [{ id: 'mistralai/voxtral-mini-tts-2603', supported_voices: ['gb_oliver_curious', 'gb_jane_neutral'] }] } }));
  await page.route('https://openrouter.ai/api/v1/audio/speech', async route => {
    const body = route.request().postDataJSON(); speechCalls++;
    expect(body.response_format).toBe('mp3'); expect(body.provider).toEqual({ zdr: true, data_collection: 'deny' });
    expect(['gb_oliver_curious', 'gb_jane_neutral']).toContain(body.voice);
    await route.fulfill({ headers: cors, contentType: 'audio/mpeg', body: rawMp3 });
  });
  await ready(page); await source(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.locator('input[name="provider"][value="openrouter"]').check();
  await page.locator('#api-key').fill(testKey);
  await page.locator('.key-form').getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
  await podcastTab(page); await page.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible({ timeout: 60000 });
  expect(speechCalls).toBe(4);
  await page.getByLabel('Podcast wiedergeben', { exact: true }).evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => page.getByLabel('Podcast wiedergeben', { exact: true }).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await page.getByLabel('Podcast wiedergeben', { exact: true }).evaluate((element: HTMLAudioElement) => element.pause());
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures/unicode.txt'));
  await expect(page.locator('.source-open').filter({ hasText: 'unicode.txt' })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.podcast-content .stale-note')).toContainText('älteren Quellenstand');
  await page.getByRole('button', { name: '02-wasserlabor.pdf löschen', exact: true }).click();
  await page.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  await expect(page.locator('.podcast-turn .citation').first()).toBeDisabled();
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible();
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true }));
  await page.reload(); await podcastTab(page);
  await expect(page.getByRole('button', { name: 'Podcast neu erstellen', exact: true })).toBeDisabled();
  await page.getByLabel('Podcast wiedergeben', { exact: true }).evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => page.getByLabel('Podcast wiedergeben', { exact: true }).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'MP3 herunterladen' })).toBeVisible();
  expect(speechCalls).toBe(4);
});

test('genuine two-tab lock contention and owner close allow explicit takeover of saved segments', async ({ page, context }) => {
  let ownerCalls = 0, peerCalls = 0;
  await mocks(page, async route => { ownerCalls++; if (ownerCalls !== 2) await speech(route); });
  await ready(page); await source(page); await saveKey(page); await podcastTab(page);
  await page.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  await expect.poll(() => ownerCalls).toBe(2);
  const peer = await context.newPage();
  await mocks(peer, async route => { peerCalls++; await speech(route); });
  await ready(peer); await saveKey(peer); await podcastTab(peer);
  await peer.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  await expect(peer.getByRole('alert')).toContainText('anderen Tab');
  expect(peerCalls).toBe(0);
  await page.close();
  await peer.reload(); await podcastTab(peer);
  await expect(peer.locator('.podcast-draft')).toContainText('1 Audioabschnitt ist gespeichert.');
  await peer.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(peer.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible({ timeout: 60000 });
  expect(peerCalls).toBe(3);
  await expect(peer.getByRole('alert')).toHaveCount(0);
  await peer.close();
});

test('five-minute 24-contribution browser encoding budget and prompt cancellation preserve ready episode', async ({ page }) => {
  await requireAudioBackend(page);
  const longTone = wavTone(12.3275, 48000);
  await mocks(page, route => route.fulfill({ headers: cors, json: { audio_data: longTone } }));
  await page.route(chatEndpoint, async route => {
    const input = JSON.parse(route.request().postDataJSON().messages.at(-1).content);
    const script = { title: 'Fünf Minuten Audioreferenz', language: input.language, turns: Array.from({ length: 24 }, (_, index) => ({ speaker: index % 2 === 0 ? 'A' : 'B', text: `Beitrag ${index + 1}: Wir prüfen die Angaben des Wasserlabors gemeinsam.`, citationIds: [input.sources[0].id] })) };
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(script) }, finish_reason: 'stop' }] } });
  });
  await ready(page); await source(page); await saveKey(page); await podcastTab(page);
  await page.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible({ timeout: 90000 });
  const telemetry = (await artifactTelemetry(page)).find(a => a.kind === 'podcast' && a.status === 'ready')!;
  expect(telemetry.durationSeconds).toBeGreaterThanOrEqual(300); expect(telemetry.durationSeconds).toBeLessThan(301);
  expect(telemetry.timeline).toHaveLength(24); expect(telemetry.encodingMs).toBeLessThanOrEqual(30000); expect(telemetry.peakBufferBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
  console.log(`${test.info().project.name} podcast reference: ${JSON.stringify(telemetry)}`);
  await page.getByRole('button', { name: 'Podcast neu erstellen', exact: true }).click();
  await expect(page.locator('.progress-banner')).toHaveAttribute('data-stage', 'encoding', { timeout: 90000 });
  const encoderWorker = page.workers().find(worker => worker.url().includes('encoder.worker'));
  expect(encoderWorker).toBeDefined();
  let workerClosedAt = 0;
  encoderWorker!.on('close', () => { workerClosedAt = Date.now(); });
  const cancelStartedAt = Date.now();
  const cancelMs = await page.evaluate(() => {
    const start = performance.now();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.progress-banner button')).find(button => button.textContent?.includes('Abbrechen'))!;
    button.click(); return performance.now() - start;
  });
  expect(cancelMs).toBeLessThanOrEqual(500);
  await expect.poll(() => workerClosedAt, { timeout: 500, intervals: [10, 20, 50] }).toBeGreaterThan(0);
  expect(workerClosedAt - cancelStartedAt).toBeLessThanOrEqual(500);
  expect(page.workers().some(worker => worker.url().includes('encoder.worker'))).toBe(false);
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible();
  const after = await artifactTelemetry(page);
  expect(after.filter(a => a.status === 'ready')).toHaveLength(1);
  expect(after.filter(a => a.status !== 'ready')).toHaveLength(1);
  console.log(`${test.info().project.name} podcast synchronous abort: ${cancelMs.toFixed(2)} ms`);
  console.log(`${test.info().project.name} encoder worker closed after ${workerClosedAt - cancelStartedAt} ms`);
});
