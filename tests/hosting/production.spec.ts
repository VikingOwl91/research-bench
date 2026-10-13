import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const chat = /https:\/\/(?:api\.eu\.mistral\.ai|openrouter\.ai)\/.*chat\/completions$/;
const mistralChat = 'https://api.eu.mistral.ai/v1/chat/completions';
const providerHosts = new Set(['api.eu.mistral.ai', 'api.mistral.ai', 'openrouter.ai']);

// Each case gets Playwright's fresh isolated context. The user's browser and
// credentials are never accessed. A deny-by-default network route is installed
// before any navigation; later fixture routes override it for controlled mocks.
test.beforeEach(async ({ page, baseURL }, info) => {
  const counts = { pageErrors: 0, consoleErrors: 0, consoleWarnings: 0, unexpectedExternalRequests: 0, unmockedProviderRequests: 0, failedSameOriginRequests: 0, cspViolations: 0 };
  const origin = new URL(baseURL!).origin;
  await page.exposeFunction('__hostingUnexpectedCSP', () => counts.cspViolations++);
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', () => { void (window as any).__hostingUnexpectedCSP(); }); });
  page.on('pageerror', () => counts.pageErrors++);
  page.on('console', event => { if (event.type() === 'error') counts.consoleErrors++; if (event.type() === 'warning') counts.consoleWarnings++; });
  page.on('requestfailed', request => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol) && url.origin === origin) counts.failedSameOriginRequests++; });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (providerHosts.has(url.hostname)) counts.unmockedProviderRequests++;
    else counts.unexpectedExternalRequests++;
    await route.abort('blockedbyclient');
  });
  // Only counts are recorded: never console text, request bodies, auth headers,
  // provider responses, network traces or documents from a real user session.
  info.annotations.push({ type: 'network-policy', description: 'Cross-origin requests require explicit controlled fixtures; no live provider requests.' });
  (page as Page & { hostingCounts?: typeof counts }).hostingCounts = counts;
});

test.afterEach(async ({ page }, info) => {
  const counts = (page as Page & { hostingCounts?: Record<string, number> }).hostingCounts!;
  await info.attach('safe-browser-diagnostics', { body: JSON.stringify(counts), contentType: 'application/json' });
  expect(counts.cspViolations, 'Unexpected CSP violations').toBe(0);
  expect(counts.pageErrors, 'Unhandled browser exceptions').toBe(0);
  expect(counts.consoleErrors, 'Browser console errors').toBe(0);
  expect(counts.failedSameOriginRequests, 'Failed static application requests').toBe(0);
  expect(counts.unexpectedExternalRequests, 'Unexpected cross-origin egress').toBe(0);
  expect(counts.unmockedProviderRequests, 'Provider request escaped explicit fixtures').toBe(0);
});

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}
async function importPDF(page: Page) {
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures/02-wasserlabor.pdf'));
  await expect(page.locator('.source-open')).toContainText('02-wasserlabor.pdf', { timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
}
async function setFixtureKey(page: Page, provider: 'mistral' | 'openrouter' = 'mistral') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator(`input[name="provider"][value="${provider}"]`).check();
  await page.locator('#api-key').fill('test-only-hosting-fixture');
  await page.locator('.key-form').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
}
async function complete(route: Route, content: unknown) {
  await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] } });
}

test('production secure capabilities, local PDF/WASM/embeddings, citations, language and persistence', async ({ page }, info) => {
  let modelReads = 0;
  page.on('request', request => { if (request.url().endsWith('/onnx/model_quantized.onnx')) modelReads++; });
  await ready(page);
  expect(await page.evaluate(async () => ({
    secure: isSecureContext,
    indexedDB: typeof indexedDB === 'object',
    cache: typeof caches === 'object',
    lock: await navigator.locks.request('researchbench-hosting-capability-probe', () => true),
  }))).toEqual({ secure: true, indexedDB: true, cache: true, lock: true });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Room for new insights.' })).toBeVisible();
  await importPDF(page);
  expect(modelReads).toBe(1);
  expect(await page.evaluate(async () => (await caches.keys()).some(key => /research|transformers/i.test(key)))).toBe(true);
  await page.getByRole('button', { name: 'Local search', exact: true }).click();
  await page.locator('#question').fill('What is the nitrate concentration in the water sample?');
  await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('02-wasserlabor.pdf');
  await page.locator('.search-result').first().click();
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await expect(page.locator('.page-controls')).toContainText('Page');
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('.page-controls')).toContainText('Seite');
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await page.screenshot({ path: info.outputPath('public-fixture-source.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('#interface-language')).toHaveValue('de');
  await expect(page.locator('.source-open')).toHaveCount(1);
  await page.getByRole('button', { name: 'Lokale Suche', exact: true }).click();
  await page.locator('#question').fill('Nitratwert der Wasserprobe');
  await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('17 Milligramm');
  expect(modelReads).toBe(1);
  await page.locator('#interface-language').selectOption('en');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('public-fixture-mobile.png'), fullPage: true });
});

test('both adapters and all three grounded Studio generators use controlled API fixtures', async ({ page }, info) => {
  let directCalls = 0, routerCalls = 0;
  await page.route(chat, async route => {
    const body = route.request().postDataJSON();
    const input = JSON.parse(body.messages.at(-1).content);
    if (route.request().url() === mistralChat) directCalls++;
    else { routerCalls++; expect(body.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true }); }
    await complete(route, { title: 'Public fixture answer', blocks: [{ heading: 'Verified source excerpt', text: 'The sample contains 17 milligrams of nitrate per liter.', citationIds: [input.sources[0].id] }] });
  });
  await ready(page); await importPDF(page); await setFixtureKey(page);
  await page.locator('#question').fill('What is the nitrate concentration?'); await page.locator('#question').press('Enter');
  await expect(page.locator('.chat-message:not(.user-message)')).toContainText('Public fixture answer');
  await setFixtureKey(page, 'openrouter');
  await page.locator('#question').fill('What does the source say?'); await page.locator('#question').press('Enter');
  await expect.poll(() => routerCalls).toBe(1);
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  for (const [tab, button] of [['Overview', 'Create Summary'], ['FAQ', 'Create FAQ'], ['Learn', 'Create Study Guide']]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.locator('.studio-panel')).toContainText('Public fixture answer');
    await expect(page.locator('.coverage-info')).toContainText('1 / 1');
    await expect(page.locator('.progress-banner')).toHaveCount(0);
  }
  expect(directCalls).toBe(1); expect(routerCalls).toBe(4);
  await page.locator('.studio-panel .citation').first().click();
  await expect(page.locator('.source-viewer mark')).toBeVisible();
  await page.screenshot({ path: info.outputPath('public-fixture-studio.png'), fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(page.locator('.studio-panel')).toContainText('Public fixture answer');
  expect(routerCalls).toBe(4);
});

function syntheticWav() {
  const rate = 48000, count = rate * 3, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 1800), 44 + i * 2);
  return bytes.toString('base64');
}

test('deployed audio Worker encodes, plays and downloads MP3 while UI language changes', async ({ page }, info) => {
  let speechCalls = 0;
  await page.route('https://api.eu.mistral.ai/v2/audio/voices**', route => route.fulfill({ headers: cors, json: { data: [{ type: 'preset', slug: 'gb_oliver_curious', id: 'oliver' }, { type: 'preset', slug: 'gb_jane_neutral', id: 'jane' }], next_page_token: null } }));
  await page.route(mistralChat, async route => {
    const input = JSON.parse(route.request().postDataJSON().messages.at(-1).content);
    expect(input.language).toBe('en');
    await complete(route, { title: 'Public source podcast', language: 'en', turns: ['What does this source say?', 'The water sample contains nitrate.', 'We can check the source excerpt.', 'Yes, the citation grounds the discussion.'].map((text, index) => ({ speaker: index % 2 ? 'B' : 'A', text, citationIds: [input.sources[0].id] })) });
  });
  const audio_data = syntheticWav();
  await page.route('https://api.eu.mistral.ai/v1/audio/speech', async route => { speechCalls++; await route.fulfill({ headers: cors, json: { audio_data } }); });
  await ready(page); await importPDF(page); await setFixtureKey(page);
  await page.getByRole('button', { name: 'Podcast', exact: true }).click();
  await expect(page.locator('#podcast-language')).toHaveValue('en');
  await page.getByRole('button', { name: 'Create podcast', exact: true }).click();
  const audio = page.locator('.podcast-player audio');
  await expect(audio).toBeVisible({ timeout: 60_000 });
  expect(speechCalls).toBe(4);
  const element = await audio.elementHandle();
  const src = await audio.getAttribute('src');
  await audio.evaluate((player: HTMLAudioElement) => { player.currentTime = 2; return player.play(); });
  await expect.poll(() => audio.evaluate((player: HTMLAudioElement) => player.currentTime)).toBeGreaterThan(2);
  await page.locator('#interface-language').selectOption('de');
  expect(await audio.evaluate((player, previous) => player === previous, element)).toBe(true);
  expect(await audio.getAttribute('src')).toBe(src);
  expect(await audio.evaluate((player: HTMLAudioElement) => player.paused)).toBe(false);
  await audio.evaluate((player: HTMLAudioElement) => player.pause());
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'MP3 herunterladen', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.mp3$/);
  const downloadPath = info.outputPath('public-fixture-podcast.mp3');
  await download.saveAs(downloadPath);
  expect(await download.failure()).toBeNull();
  const mp3 = await readFile(downloadPath);
  expect(mp3.length).toBeGreaterThan(1000);
  expect(mp3.subarray(0, 3).toString() === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0)).toBe(true);
  await page.locator('.podcast-player').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('public-fixture-podcast.png'), fullPage: true });
  await page.locator('#podcast-language').selectOption('de');
  await expect(page.locator('#podcast-language option[value="de"]')).toHaveText('Deutsch (experimentell)');
  await expect(page.locator('.podcast-content .stale-note')).toContainText('Deutsche Stimmprofile sind nicht verfügbar');
  await element?.dispose();
});
