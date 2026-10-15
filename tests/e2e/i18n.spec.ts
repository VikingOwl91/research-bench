import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
import { requireAudioBackend } from './audio-backend';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const endpoint = 'https://api.eu.mistral.ai/v1/chat/completions';
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}
async function source(page: Page) {
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures/02-wasserlabor.pdf'));
  await expect(page.locator('.source-open')).toContainText('02-wasserlabor.pdf', { timeout: 180000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180000 });
}
async function key(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#api-key').fill('test-only-i18n-key');
  await page.locator('.key-form').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
}
async function answer(route: Route, title: string) {
  const input = JSON.parse(route.request().postDataJSON().messages.at(-1).content);
  await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify({ title, blocks: [{ text: 'Original generated content.', citationIds: [input.sources[0].id] }] }) }, finish_reason: 'stop' }] } });
}

test('English default ignores browser language; live UI choice persists without translating stored names', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'language', { value: 'de-DE' }));
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#interface-language')).toHaveValue('en');
  await expect(page.getByRole('heading', { name: 'Room for new insights.' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Active notebook' })).toContainText('My first notebook');
  await expect(page.locator('meta[name="description"]')).toHaveCount(1);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Your private research workspace/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connection & privacy' })).toBeVisible();
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-i18n-en-settings.png`, fullPage: true });
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { name: 'Verbindung & Datenschutz' })).toBeVisible();
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
  await expect(page.getByRole('combobox', { name: 'Aktives Notebook' })).toContainText('My first notebook');
  await page.reload();
  await expect(page.locator('#interface-language')).toHaveValue('de');
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeEnabled();
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-i18n-de.png`, fullPage: true });
  await page.locator('#interface-language').selectOption('en');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Interface language' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-i18n-en-mobile.png`, fullPage: true });
});

test('source-reference limits remain visible in EN/DE chat and every Studio tab on desktop/mobile', async ({ page }) => {
  await ready(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const language of ['en', 'de'] as const) {
      await page.locator('#interface-language').selectOption(language);
      const english = language === 'en';
      const limitation = english ? 'factual support is not automatically verified' : 'die inhaltliche Belegbarkeit wird nicht automatisch geprüft';
      const unsupported = english ? 'unsupported claims' : 'unbelegte Aussagen';
      if (width === 390) await page.locator('.mobile-navigation').getByRole('button', { name: english ? 'Research' : 'Recherche', exact: true }).click();
      await expect(page.locator('.local-pill')).toHaveText(english ? 'Source references' : 'Quellenverweise');
      await expect(page.locator('.composer-footnote')).toBeVisible();
      await expect(page.locator('.composer-footnote')).toContainText(limitation);
      await expect(page.locator('.composer-footnote')).toContainText(unsupported);
      if (width === 390) await page.locator('.mobile-navigation').getByRole('button', { name: 'Studio', exact: true }).click();
      for (const tab of [english ? 'Overview' : 'Überblick', 'FAQ', english ? 'Learn' : 'Lernen', 'Podcast']) {
        await page.locator('.generator-tabs').getByRole('button', { name: tab, exact: true }).click();
        await expect(page.locator('.studio-intro .source-reference-note')).toBeVisible();
        await expect(page.locator('.studio-intro .source-reference-note')).toContainText(limitation);
        await expect(page.locator('.studio-intro .source-reference-note')).toContainText(unsupported);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `.cache/verification/${test.info().project.name}-transparency-${language}-${width}.png`, fullPage: true });
    }
  }
});

test('invalid and blocked language storage keep an English default and allow in-memory switching', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('researchbench:locale', 'fr');
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (name) { if (name === 'researchbench:locale') throw new DOMException('blocked', 'SecurityError'); return get.call(this, name); };
    Storage.prototype.setItem = function (name, value) { if (name === 'researchbench:locale') throw new DOMException('blocked', 'SecurityError'); return set.call(this, name, value); };
  });
  await ready(page);
  await page.locator('#interface-language').selectOption('de');
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeEnabled();
  await page.locator('#interface-language').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('locale changes preserve indexing and generation; errors and source controls translate live', async ({ page }) => {
  let model: Route | undefined;
  await page.route('**/onnx/model_quantized.onnx', route => { model = route; });
  await ready(page);
  await page.locator('#source-upload').setInputFiles(resolve('tests/fixtures/02-wasserlabor.pdf'));
  await expect.poll(() => !!model).toBe(true);
  await expect(page.locator('.progress-banner')).toContainText('Loading local model');
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('.progress-banner')).toContainText('Lokales Modell wird geladen');
  await expect(page.locator('.progress-banner')).toContainText('Datei 1 / 1');
  await model!.continue();
  await page.unroute('**/onnx/model_quantized.onnx');
  await expect(page.locator('.source-open')).toBeVisible({ timeout: 180000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180000 });
  await page.locator('#interface-language').selectOption('en');
  await key(page);
  let pending: Route | undefined;
  const prompts: string[] = [];
  await page.route(endpoint, route => { prompts.push(route.request().postDataJSON().messages[0].content); pending = route; });
  await page.locator('#question').fill('What do the sources say?');
  await page.locator('#question').press('Enter');
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toContain('Respond in English');
  await expect(page.locator('.progress-banner')).toContainText('is generating an answer using your sources');
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('.progress-banner')).toContainText('generiert eine Antwort anhand deiner Quellen');
  await answer(pending!, 'English answer remains English');
  await expect(page.locator('.chat-message:not(.user-message)')).toContainText('English answer remains English');
  expect(prompts).toHaveLength(1);
  await page.locator('.chat-message .citation').first().click();
  const highlighted = await page.locator('.source-viewer mark').textContent();
  await expect(page.locator('.page-controls')).toContainText('Seite');
  await page.locator('#interface-language').selectOption('en');
  await expect(page.locator('.page-controls')).toContainText('Page');
  await expect(page.locator('.source-viewer mark')).toHaveText(highlighted!);
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  await page.locator('#interface-language').selectOption('de');
  await page.locator('#question').fill('Weitere Frage'); await page.locator('#question').press('Enter');
  await expect.poll(() => prompts.length).toBe(2);
  expect(prompts[1]).toContain('Antworte auf Deutsch');
  await pending!.fulfill({ headers: cors, status: 401, json: { message: 'server-body-must-not-render' } });
  await expect(page.getByRole('alert')).toContainText('API-Key');
  await page.locator('#interface-language').selectOption('en');
  await expect(page.getByRole('alert')).toContainText('API key');
  await expect(page.getByRole('alert')).not.toContainText('server-body-must-not-render');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.locator('#source-upload').setInputFiles({ name: 'invalid-utf8.txt', mimeType: 'text/plain', buffer: Buffer.from([0xff, 0xfe, 0xff]) });
  await expect(page.getByRole('alert')).toContainText('not valid UTF-8');
  await page.locator('#interface-language').selectOption('de');
  await expect(page.getByRole('alert')).toContainText('nicht gültig als UTF-8');
  await expect(page.locator('.source-open')).toHaveCount(1);
});

// Synthetic WAV exercises actual browser decoding/MP3 encoding, without paid voices.
function wav() {
  const rate = 48000, count = rate * 3, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 1800), 44 + i * 2);
  return bytes.toString('base64');
}
test('podcast speech stays independently English; locale switching preserves rendering and active playback', async ({ page }) => {
  await requireAudioBackend(page);
  await ready(page); await source(page); await key(page);
  await page.route('https://api.eu.mistral.ai/v2/audio/voices**', route => route.fulfill({ headers: cors, json: { data: [{ type: 'preset', slug: 'gb_oliver_curious', id: 'oliver' }, { type: 'preset', slug: 'gb_jane_neutral', id: 'jane' }], next_page_token: null } }));
  let scriptCalls = 0, speechCalls = 0, first: Route | undefined;
  const audio_data = wav();
  await page.route(endpoint, async route => {
    scriptCalls++;
    const input = JSON.parse(route.request().postDataJSON().messages.at(-1).content);
    expect(input.language).toBe('en');
    const script = { title: 'Original English podcast', language: 'en', turns: ['What does the source say?', 'The sample contains nitrate.', 'We can check the cited source.', 'Yes, that keeps us grounded.'].map((text, i) => ({ speaker: i % 2 ? 'B' : 'A', text, citationIds: [input.sources[0].id] })) };
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(script) }, finish_reason: 'stop' }] } });
  });
  await page.route('https://api.eu.mistral.ai/v1/audio/speech', async route => {
    speechCalls++;
    if (speechCalls === 1) first = route;
    else await route.fulfill({ headers: cors, json: { audio_data } });
  });
  await page.getByRole('button', { name: 'Podcast', exact: true }).click();
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('#podcast-language')).toHaveValue('en');
  await page.getByRole('button', { name: 'Podcast erstellen', exact: true }).click();
  await expect.poll(() => !!first).toBe(true);
  await page.locator('#interface-language').selectOption('en');
  await expect(page.locator('.progress-banner')).toContainText('Generating podcast contributions');
  await first!.fulfill({ headers: cors, json: { audio_data } });
  const audio = page.locator('.podcast-player audio');
  await expect(audio).toBeVisible({ timeout: 60000 });
  expect(scriptCalls).toBe(1); expect(speechCalls).toBe(4);
  const handle = await audio.elementHandle();
  const url = await audio.getAttribute('src');
  await audio.evaluate((a: HTMLAudioElement) => { a.currentTime = 2; return a.play(); });
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(2);
  await page.locator('#interface-language').selectOption('de');
  await expect(page.getByLabel('Podcast wiedergeben', { exact: true })).toBeVisible();
  expect(await audio.evaluate((a, previous) => a === previous, handle)).toBe(true);
  expect(await audio.getAttribute('src')).toBe(url);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false);
  expect(await audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(2);
  await expect(page.locator('#podcast-language')).toHaveValue('en');
  await expect(page.locator('.podcast-title')).toHaveText('Original English podcast');
  await audio.evaluate((a: HTMLAudioElement) => a.pause());
  await page.getByRole('button', { name: /Zu Beitrag 3 springen$/ }).click();
  await expect(page.locator('.podcast-turn').nth(2)).toHaveClass(/playing/);
  await page.locator('#interface-language').selectOption('en');
  await page.locator('.podcast-player').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-i18n-en-podcast.png`, fullPage: true });
  await page.locator('#podcast-language').selectOption('de');
  await expect(page.locator('#podcast-language option[value="de"]')).toHaveText('German (experimental)');
  await expect(page.locator('.podcast-content .stale-note')).toContainText('native German voices are unavailable');
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('.podcast-content .stale-note')).toContainText('Deutsche Stimmprofile sind nicht verfügbar');
  expect(scriptCalls).toBe(1); expect(speechCalls).toBe(4);
  await handle?.dispose();
});
