import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

// Each test owns its disposable browser context. Only loopback assets and intercepted
// provider requests are permitted; no user profile, real key, disk or credit quota is used.
const origin = 'http://127.0.0.1:4173';
const provider = 'https://api.eu.mistral.ai';
const chat = `${provider}/v1/chat/completions`;
const voices = `${provider}/v2/audio/voices`;
const speech = `${provider}/v1/audio/speech`;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const dummyKey = 'test-only-submission-key';

function tone() {
  // Synthetic original WAV exercises native decoding and the actual MP3 encoder worker.
  const rate = 24_000, count = rate;
  const bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 1800), 44 + i * 2);
  return bytes.toString('base64');
}
const audio_data = tone();
const unexpectedEgress = new WeakMap<Page, string[]>();
const pageErrors = new WeakMap<Page, string[]>();

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'Active notebook' })).toBeVisible();
}
async function source(page: Page, name = '02-wasserlabor.pdf') {
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures', name));
  await expect(page.locator('.source-open').filter({ hasText: name })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled();
}
async function key(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#api-key').fill(dummyKey);
  await page.locator('.key-form').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
}
async function ask(page: Page) {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('#question').fill('What is the nitrate concentration?');
  await page.locator('#question').press('Enter');
}
async function podcast(page: Page) {
  await page.getByRole('button', { name: 'Podcast', exact: true }).click();
}
async function speechSuccess(route: Route) { await route.fulfill({ headers: cors, json: { audio_data } }); }
async function mocks(page: Page, onSpeech = speechSuccess) {
  await page.route(voices + '**', route => route.fulfill({ headers: cors, json: { data: [{ type: 'preset', slug: 'gb_oliver_curious', id: 'voice-oliver' }, { type: 'preset', slug: 'gb_jane_neutral', id: 'voice-jane' }], next_page_token: null } }));
  await page.route(speech, onSpeech);
  await page.route(chat, async route => {
    const body = route.request().postDataJSON();
    const input = JSON.parse(body.messages.at(-1).content);
    const citation = input.sources[0].id;
    const answer = body.response_format.json_schema.name === 'researchbench_podcast'
      ? { title: 'Water findings', language: input.language, turns: [
          { speaker: 'A', text: 'What does the water sample tell us?', citationIds: [citation] },
          { speaker: 'B', text: 'It contains 17 milligrams of nitrate per litre.', citationIds: [citation] },
          { speaker: 'A', text: 'We can check this finding in the supplied source.', citationIds: [citation] },
          { speaker: 'B', text: 'Yes, our conclusion stays tied to that source.', citationIds: [citation] }
        ] }
      : { title: 'Saved water finding', blocks: [{ text: '17 milligrams of nitrate per litre.', citationIds: [citation] }] };
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] } });
  });
}

async function inventory(page: Page) {
  return page.evaluate(async () => new Promise<{ sources: string[]; chunks: string[]; revisions: number[]; podcasts: { id: string; status: string; completed: number }[]; audio: { id: string; kind: string; size: number; sha256: string }[] }>((resolve, reject) => {
    const request = indexedDB.open('researchbench-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['sources', 'chunks', 'notebooks', 'artifacts', 'audio']);
      const names = ['sources', 'chunks', 'notebooks', 'artifacts', 'audio'] as const;
      const rows = names.map(name => tx.objectStore(name).getAll());
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = async () => {
        const audio = await Promise.all(rows[4].result.map(async row => {
          const blob: Blob = row.blob ?? row.segment.blob;
          const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
          return { id: row.id, kind: row.kind, size: blob.size, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
        }));
        resolve({ sources: rows[0].result.map(row => row.id), chunks: rows[1].result.map(row => row.id), revisions: rows[2].result.map(row => row.revision), podcasts: rows[3].result.filter(row => row.kind === 'podcast').map(row => ({ id: row.id, status: row.status, completed: row.completedTurnIds.length })), audio });
        db.close();
      };
    };
  }));
}

async function quotaOnce(page: Page, store: 'sources' | 'audio') {
  await page.evaluate(store => {
    // Inject one platform-shaped failure at the real native IDB boundary. All reads,
    // other writes, transaction rollbacks and persisted artifacts remain real.
    const original = IDBObjectStore.prototype.add;
    (window as any).__quotaHits = 0;
    IDBObjectStore.prototype.add = function(value: any, key?: IDBValidKey) {
      if (this.name === store && (store !== 'audio' || value.kind === 'final')) {
        IDBObjectStore.prototype.add = original;
        (window as any).__quotaHits++;
        throw new DOMException('test-only-native-quota', 'QuotaExceededError');
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  }, store);
}
async function ended(page: Page) {
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.locator('#source-upload')).toBeEnabled();
}

test.beforeEach(async ({ context, page }) => {
  const denied: string[] = [], errors: string[] = [];
  unexpectedEgress.set(page, denied); pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('researchbench:locale', 'en'));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    denied.push(route.request().url());
    return route.abort('blockedbyclient');
  });
});

test.afterEach(async ({ page }) => {
  expect(unexpectedEgress.get(page)).toEqual([]);
  expect(pageErrors.get(page)).toEqual([]);
});

test('empty notebook keeps generation unavailable and makes no provider requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith(origin + '/')) external.push(request.url()); });
  await ready(page); await key(page);
  await expect(page.locator('#question')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Create Summary', exact: true })).toBeDisabled();
  await podcast(page);
  await expect(page.getByRole('button', { name: 'Create podcast', exact: true })).toBeDisabled();
  await expect(page.locator('.podcast-generate')).toContainText('Add a source first.');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('blocked native IndexedDB presents an actionable safe storage message', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function() { throw new DOMException('test-only-storage-private-marker', 'SecurityError'); };
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Allow website data for ResearchBench.');
  await expect(page.getByRole('alert')).not.toContainText('test-only-storage-private-marker');
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.locator('#source-upload')).toBeDisabled();
  await expect(page.locator('#question')).toBeDisabled();
});

test('native import quota preserves source, chunks and revision and permits explicit retry', async ({ page }) => {
  await ready(page); await source(page);
  const before = await inventory(page);
  await quotaOnce(page, 'sources');
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures/unicode.txt'));
  await expect(page.getByRole('alert')).toContainText('Browser storage is full. Remove sources or use a smaller notebook.');
  await expect(page.getByRole('alert')).not.toContainText('test-only-native-quota');
  await ended(page);
  expect(await page.evaluate(() => (window as any).__quotaHits)).toBe(1);
  expect(await inventory(page)).toEqual(before);
  await expect(page.locator('.import-report')).toContainText('Imported: 0 · Failed: 1 · Canceled: 0 · Not attempted: 0');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await source(page, 'unicode.txt');
  await expect(page.locator('.source-open')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('chat 429 and network loss preserve saved answers; warm offline search, viewer and audio work', async ({ page, context }) => {
  await mocks(page); await ready(page); await source(page); await key(page);
  await ask(page);
  await expect(page.locator('.chat-message:not(.user-message)')).toContainText('Saved water finding');
  await ended(page);
  await page.route(chat, route => route.fulfill({ headers: cors, status: 429, json: { error: `private-body ${dummyKey}` } }));
  await ask(page);
  await expect(page.getByRole('alert')).toContainText('Rate limit reached. Wait briefly and generate again.');
  await expect(page.getByRole('alert')).not.toContainText(dummyKey);
  await ended(page);
  await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.unroute(chat); await mocks(page);
  await podcast(page); await page.getByRole('button', { name: 'Create podcast', exact: true }).click();
  const audio = page.getByLabel('Play podcast', { exact: true });
  await expect(audio).toBeVisible({ timeout: 60_000 });
  await ended(page);
  const before = await inventory(page);
  let providerAttempts = 0;
  // Mocks bypass network availability, so deliberately abort provider requests as
  // well as taking the owned context offline. No API response can mask the failure.
  await page.route(chat, route => { providerAttempts++; return route.abort('internetdisconnected'); });
  await page.evaluate(endpoint => {
    const original = window.fetch;
    (window as any).__offlineChatCalls = 0;
    window.fetch = function(input, init) {
      const url = input instanceof Request ? input.url : String(input);
      if (url === endpoint) (window as any).__offlineChatCalls++;
      return original.call(this, input, init);
    };
  }, chat);
  await context.setOffline(true);
  await ask(page);
  await expect(page.getByRole('alert')).toContainText('The API is unreachable. Check your connection');
  await ended(page);
  await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.getByRole('button', { name: 'Local search', exact: true }).click();
  await page.locator('#question').fill('What is the nitrate concentration?'); await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('17 Milligramm');
  await page.locator('.search-result').first().click();
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await podcast(page);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await audio.evaluate((element: HTMLAudioElement) => element.pause());
  await expect(page.getByRole('link', { name: 'Download MP3' })).toHaveAttribute('href', /^blob:/);
  expect(await inventory(page)).toEqual(before);
  expect(await page.evaluate(() => (window as any).__offlineChatCalls)).toBe(1);
  // Firefox may reject fetch before the route handler; Chromium reaches it.
  expect(providerAttempts).toBeLessThanOrEqual(1);
  await context.setOffline(false);
});

test('mid-podcast 429 and final native audio quota keep the ready episode and resume only missing work', async ({ page }) => {
  let calls = 0, failSpeech = false;
  await mocks(page, async route => {
    calls++;
    if (failSpeech && calls === 6) return route.fulfill({ headers: cors, status: 429, json: { error: `private-body ${dummyKey}` } });
    await speechSuccess(route);
  });
  await ready(page); await source(page); await key(page); await podcast(page);
  await page.getByRole('button', { name: 'Create podcast', exact: true }).click();
  await expect(page.getByLabel('Play podcast', { exact: true })).toBeVisible({ timeout: 60_000 });
  expect(calls).toBe(4);
  const original = await inventory(page);
  const readyEpisode = original.podcasts.find(row => row.status === 'ready')!;
  const readyAudio = original.audio.find(row => row.kind === 'final')!;
  expect(readyAudio.size).toBeGreaterThan(2000);
  failSpeech = true;
  await page.getByRole('button', { name: 'Create podcast again', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('explicitly resume the podcast');
  await ended(page);
  await expect(page.locator('.podcast-draft')).toContainText('1 audio segment is saved.');
  await expect(page.getByLabel('Play podcast', { exact: true })).toBeVisible();
  const interrupted = await inventory(page);
  expect(interrupted.podcasts).toContainEqual(readyEpisode);
  expect(interrupted.audio).toContainEqual(readyAudio);
  expect(interrupted.audio.filter(row => row.kind === 'segment')).toHaveLength(1);
  expect(calls).toBe(6); // four original turns, one new saved turn, one rejected turn.
  await quotaOnce(page, 'audio');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Browser storage is full.');
  await expect(page.getByRole('alert')).not.toContainText('test-only-native-quota');
  await ended(page);
  await expect(page.locator('.podcast-draft')).toContainText('4 audio segments are saved.');
  await expect(page.getByLabel('Play podcast', { exact: true })).toBeVisible();
  expect(calls).toBe(9); // only the three missing turns were generated.
  expect(await page.evaluate(() => (window as any).__quotaHits)).toBe(1);
  const rejected = await inventory(page);
  expect(rejected.podcasts).toContainEqual(readyEpisode);
  expect(rejected.audio).toContainEqual(readyAudio);
  expect(rejected.audio.filter(row => row.kind === 'final')).toHaveLength(1);
  expect(rejected.audio.filter(row => row.kind === 'segment')).toHaveLength(4);
  expect(rejected.audio).toContainEqual(interrupted.audio.find(row => row.kind === 'segment')); // completed PCM bytes stay identical.
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('.podcast-draft')).toHaveCount(0);
  await ended(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const completed = await inventory(page);
  expect(completed.podcasts).toHaveLength(1);
  expect(completed.podcasts[0].status).toBe('ready');
  expect(completed.podcasts[0].id).not.toBe(readyEpisode.id);
  expect(completed.audio).toHaveLength(1);
  expect(completed.audio[0].kind).toBe('final');
  expect(calls).toBe(9); // retrying only encoding/atomic finalization costs no TTS calls.
});
