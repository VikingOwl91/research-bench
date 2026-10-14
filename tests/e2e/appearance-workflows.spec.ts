import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AxeResults } from 'axe-core';

const endpoint = 'https://api.eu.mistral.ai/v1/chat/completions';
const voicesEndpoint = 'https://api.eu.mistral.ai/v2/audio/voices';
const speechEndpoint = 'https://api.eu.mistral.ai/v1/audio/speech';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
const longName = `Interface-only-fictional-water-laboratory-source-${'long-name-'.repeat(9)}äöü.pdf`;
const fixtureTitle = 'Rendered interface fixture — synthetic output, not a factual model assessment';
const fixtureParagraph = `This synthetic paragraph exercises the presentation of generated content and source buttons. ${'Presentation text with a long filename and a cited source remains readable. '.repeat(5)}LongToken${'x'.repeat(150)}`;

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}

async function pane(page: Page, name: 'Sources' | 'Research' | 'Studio') {
  const navigation = page.locator('.mobile-navigation');
  if (await navigation.isVisible()) await navigation.getByRole('button', { name, exact: true }).click();
}

async function appearance(page: Page, value: 'light' | 'dark') {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Appearance', { exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
}

async function key(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#api-key').fill('test-only-appearance-workflows-key');
  await page.locator('.key-form').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
}

async function upload(page: Page, renamed = false) {
  await page.locator('#source-upload').setInputFiles(renamed
    ? { name: longName, mimeType: 'application/pdf', buffer: readFileSync(resolve('tests/fixtures/02-wasserlabor.pdf')) }
    : resolve('tests/fixtures/02-wasserlabor.pdf'));
}

async function indexed(page: Page) {
  await expect(page.locator('.source-open')).toHaveCount(1, { timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
}

function input(route: Route): { sources: Array<{ id: string; page: number; text: string }>; task?: string; language?: string } {
  return JSON.parse(route.request().postDataJSON().messages.at(-1).content);
}

async function answer(route: Route, title = fixtureTitle) {
  const sources = input(route).sources;
  await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify({
    title, blocks: [{ heading: 'Interface presentation fixture', text: fixtureParagraph, citationIds: [sources[0].id] }]
  }) }, finish_reason: 'stop' }] } });
}

async function evidence(page: Page, state: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${state}: horizontal page overflow`).toBe(true);
  if (page.viewportSize()!.width > 1100) {
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), `${state}: vertical page overflow`).toBe(true);
    // Generated text and source pages must remain reachable inside their own regions.
    const region = page.locator('.source-scroll:visible, .research-feed:visible, .studio-content:visible');
    for (const content of await region.all()) {
      await content.focus();
      await page.keyboard.press('Control+End');
      await expect.poll(() => content.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => scrollY), `${state}: pane scrolling moved the document`).toBe(0);
      await content.evaluate(node => node.scrollTop = 0);
    }
  }
  await page.evaluate(axeSource);
  const report = await page.evaluate(async () => (window as any).axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }
  })) as AxeResults;
  const directory = resolve('.cache/ui-v004/workflow-evidence');
  await mkdir(directory, { recursive: true });
  const name = `${test.info().project.name}-${state}`;
  await writeFile(resolve(directory, `${name}-axe.json`), JSON.stringify(report, null, 2));
  await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
  expect(report.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), `${state}: rendered accessibility`).toEqual([]);
}

function wavTone(seconds = 3) {
  const rate = 48_000, samples = seconds * rate;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * index / rate) * 1_800), 44 + index * 2);
  return bytes.toString('base64');
}

test('appearance changes preserve a held real indexing job and its subsequent held generation', async ({ page }) => {
  let model: Route | undefined;
  let modelRequests = 0;
  await page.route('**/onnx/model_quantized.onnx', route => { modelRequests++; model = route; });
  await ready(page);
  await upload(page);
  await expect.poll(() => !!model).toBe(true);
  await expect(page.locator('.progress-banner')).toContainText('Loading local model');
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'indexing feedback must fit the desktop window').toBe(true);
  await appearance(page, 'dark');
  await appearance(page, 'light');
  await expect(page.locator('.progress-banner')).toContainText('Loading local model');
  await expect(page.locator('#source-upload')).toBeDisabled();
  expect(modelRequests).toBe(1);
  await model!.continue();
  await page.unroute('**/onnx/model_quantized.onnx');
  await indexed(page);
  await key(page);

  let pending: Route | undefined;
  const requests: unknown[] = [];
  await page.route(endpoint, route => { requests.push(route.request().postDataJSON()); pending = route; });
  await page.locator('#question').fill('Show the synthetic presentation fixture.');
  await page.locator('#question').press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  const originalRequest = JSON.stringify(requests[0]);
  await appearance(page, 'dark');
  await expect(page.locator('.progress-banner')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'generation feedback must fit the desktop window').toBe(true);
  await expect(page.locator('#question')).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0])).toBe(originalRequest);
  await answer(pending!);
  await expect(page.locator('.chat-message:not(.user-message) .answer-title')).toHaveText(fixtureTitle);
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await page.locator('.chat-message .citation').first().click();
  await expect(page.locator('.source-viewer mark')).not.toBeEmpty();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(modelRequests).toBe(1);
  expect(requests).toHaveLength(1);
});

test('filled workflows keep audio identity while themes change and render accessible long-name citations at mobile, tablet and desktop widths', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [], unexpected: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('blob:') &&
      !request.url().startsWith(endpoint) && !request.url().startsWith(voicesEndpoint) && !request.url().startsWith(speechEndpoint)) unexpected.push(request.url());
  });
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem;
    (window as any).appearanceKeyReads = 0;
    Storage.prototype.getItem = function (name) {
      if (name.startsWith('researchbench:key:')) (window as any).appearanceKeyReads++;
      return read.call(this, name);
    };
  });
  const audio = wavTone();
  let scripts = 0, speech = 0, textRequests = 0;
  await page.route(voicesEndpoint + '**', route => route.fulfill({ headers: cors, json: { data: [
    { id: 'interface-voice-a', slug: 'gb_oliver_curious', type: 'preset' },
    { id: 'interface-voice-b', slug: 'gb_jane_neutral', type: 'preset' }
  ] } }));
  await page.route(speechEndpoint, route => { speech++; return route.fulfill({ headers: cors, json: { audio_data: audio } }); });
  await page.route(endpoint, async route => {
    const data = input(route);
    if (data.language) {
      scripts++;
      await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify({
        title: 'Synthetic podcast presentation fixture', language: 'en',
        turns: Array.from({ length: 4 }, (_, index) => ({ speaker: index % 2 ? 'B' : 'A', text: fixtureParagraph, citationIds: [data.sources[0].id] }))
      }) }, finish_reason: 'stop' }] } });
    } else {
      textRequests++;
      const kind = data.task?.includes('Zusammenfassung') ? 'Summary' : data.task?.includes('häufige Fragen') ? 'FAQ' : data.task?.includes('Study Guide') ? 'Study Guide' : 'Chat';
      await answer(route, `${kind}: ${fixtureTitle}`);
    }
  });
  await ready(page);
  await upload(page, true);
  await indexed(page);
  await key(page);
  await page.locator('#question').fill('Show the synthetic presentation fixture.');
  await page.locator('#question').press('Enter');
  await expect(page.locator('.chat-message:not(.user-message) .answer-title')).toHaveText(`Chat: ${fixtureTitle}`);
  for (const [tab, title] of [['Overview', 'Summary'], ['FAQ', 'FAQ'], ['Learn', 'Study Guide']] as const) {
    await page.locator('.generator-tabs').getByRole('button', { name: tab, exact: true }).click();
    await page.locator('.studio-generate > .button').click();
    await expect(page.locator('.studio-content .answer-title')).toHaveText(`${title}: ${fixtureTitle}`);
  }
  await page.locator('.generator-tabs').getByRole('button', { name: 'Podcast', exact: true }).click();
  await page.locator('.podcast-generate > .button').click();
  const player = page.getByLabel('Play podcast', { exact: true });
  await expect(player).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => player.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  const initialSource = await player.getAttribute('src');
  await player.evaluate(async (node: HTMLAudioElement) => {
    (window as any).appearanceAudio = node;
    (window as any).appearanceKeyReads = 0;
    node.currentTime = 0; await node.play();
  });
  await expect.poll(() => player.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.2);
  const before = await player.evaluate((node: HTMLAudioElement) => node.currentTime);
  await appearance(page, 'dark');
  expect(await player.evaluate(node => node === (window as any).appearanceAudio)).toBe(true);
  await expect(player).toHaveAttribute('src', initialSource!);
  await expect.poll(() => player.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(before);
  expect(await player.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);
  expect(await page.evaluate(() => (window as any).appearanceKeyReads)).toBe(0);
  expect({ scripts, speech, textRequests }).toEqual({ scripts: 1, speech: 4, textRequests: 4 });
  await player.evaluate((node: HTMLAudioElement) => node.pause());

  for (const theme of ['light', 'dark'] as const) {
    await appearance(page, theme);
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: width === 320 ? 844 : width === 1280 ? 720 : 1000 });
      await pane(page, 'Research');
      await page.locator('.research-tabs').getByRole('button', { name: 'Chat', exact: true }).click();
      await page.locator('.research-feed').evaluate(node => node.scrollTop = 0);
      await evidence(page, `${theme}-${width}-filled-chat`);
      await page.locator('.chat-message .citation').first().click();
      const highlighted = await page.locator('.source-viewer mark').textContent();
      await evidence(page, `${theme}-${width}-source-viewer`);
      await expect(page.locator('.source-viewer mark')).toHaveText(highlighted!);
      await page.getByRole('button', { name: 'Close source viewer' }).click();
      await pane(page, 'Studio');
      for (const tab of ['Overview', 'FAQ', 'Learn', 'Podcast']) {
        await page.locator('.generator-tabs').getByRole('button', { name: tab, exact: true }).click();
        await expect(page.locator('.studio-content .answer-title')).toBeVisible();
        await page.locator('.studio-content').evaluate(node => node.scrollTop = 0);
        await evidence(page, `${theme}-${width}-filled-${tab.toLowerCase()}`);
      }
    }
  }
  expect({ scripts, speech, textRequests }).toEqual({ scripts: 1, speech: 4, textRequests: 4 });
  expect(await page.evaluate(() => (window as any).appearanceKeyReads)).toBe(0);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
