import { test, expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
const fixture = (name: string) => resolve('tests/fixtures', name);
const endpoint = /https:\/\/(api\.eu\.mistral\.ai|openrouter\.ai)\/.*chat\/completions/;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
const dummyKeys = { mistral: 'test-only-mistral-key', openrouter: 'test-only-openrouter-key' };
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('researchbench:locale', 'de'));
});
async function importFiles(page: Page, names: string[]) {
  await page.locator('#source-upload').setInputFiles(names.map(fixture));
  for (const name of names) await expect(page.locator('.source-open').filter({ hasText: name })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
}
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeEnabled();
  // Controller creates the first notebook automatically. If the policy changes, create it explicitly.
  if (!await page.getByRole('combobox', { name: 'Aktives Notebook' }).count()) {
    await page.getByRole('button', { name: 'Notebook erstellen', exact: true }).first().click();
    await page.getByLabel('Neues Notebook', { exact: true }).fill('Meine Recherche');
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  }
}
async function key(page: Page, provider: 'mistral' | 'openrouter') {
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.locator(`input[name="provider"][value="${provider}"]`).check();
  await page.locator('#api-key').fill(dummyKeys[provider]);
  await page.locator('.key-form').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.locator('.key-form .ready-badge')).toContainText('Hinterlegt');
  await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
}
function answerFor(route: Route) {
  const body = route.request().postDataJSON();
  const input = JSON.parse(body.messages.at(-1).content);
  const temperature = typeof input.task === 'string' && input.task.includes('Temperatur');
  const water = temperature ? input.sources[0] : input.sources.find((s: {text:string}) => s.text.includes('17 Milligramm')) ?? input.sources[0];
  return { body, input, answer: { title: 'Belegte Antwort', blocks: [{ heading: 'Ergebnis', text: temperature ? 'Die Wasserproben lagern bei vier Grad Celsius.' : 'Die Probe enthält 17 Milligramm Nitrat pro Liter.', citationIds: [water.id] }] } };
}
async function fulfil(route: Route) {
  const { answer } = answerFor(route);
  await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] } });
}
async function ask(page: Page, question = 'Wie hoch ist der Nitratwert der Probe vom 3. Juni?') {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.locator('#question').fill(question); await page.locator('#question').press('Enter');
}

test('real PDFium + local multilingual embeddings: retrieval, reload, isolation and rejected PDFs', async ({ page }, testInfo) => {
  const external: string[] = [];
  const modelReads: string[] = [];
  page.on('request', r => {
    if (!r.url().startsWith('http://127.0.0.1:4173')) external.push(r.url());
    if (r.method() === 'GET' && r.url().endsWith('/onnx/model_quantized.onnx')) modelReads.push(r.url());
  });
  await ready(page);
  await importFiles(page, ['01-solarprojekt.pdf', '02-wasserlabor.pdf', '03-forest-study.pdf']);
  expect(modelReads).toHaveLength(1);
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Lokale Suche', exact: true }).click();
  await page.locator('#question').fill('How many oak seedlings survived winter?'); await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('03-forest-study.pdf');
  await page.locator('.search-result').first().click();
  await expect(page.locator('.source-viewer mark')).toContainText('216');
  await expect(page.locator('.page-controls')).toContainText('Seite 1 / 2');
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-source-highlight.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.locator('.source-open')).toHaveCount(3);
  await page.getByRole('button', { name: 'Lokale Suche', exact: true }).click();
  await page.locator('#question').fill('Wie hoch ist der Nitratwert?'); await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('02-wasserlabor.pdf');
  // Warm reload reads the model from its owned CacheStorage. Chromium retains the
  // 118-MB model; Firefox default profiles can re-download it (CacheStorage
  // per-entry quota) — per-profile retention is not guaranteed (docs/verification.md).
  expect(modelReads).toHaveLength(testInfo.project.name === 'firefox' ? 2 : 1);
  const firstNotebook = await page.getByRole('combobox', { name: 'Aktives Notebook' }).inputValue();
  await page.getByRole('button', { name: 'Notebook erstellen', exact: true }).click();
  await page.locator('#notebook-name').fill('Getrennte Recherche'); await page.locator('.notebook-form').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.source-open')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Aktives Notebook' }).selectOption(firstNotebook);
  await expect(page.locator('.source-open')).toHaveCount(3);
  await page.locator('#source-upload').setInputFiles(fixture('corrupt.pdf'));
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('.source-open')).toHaveCount(3);
  await page.getByRole('button', { name: 'Fehler schließen' }).click();
  await page.locator('#source-upload').setInputFiles(fixture('textless.pdf'));
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.locator('.source-open')).toHaveCount(3);
  expect(external).toEqual([]);
});

test('both BYOK adapters, citations, generated coverage, staleness, safe source rendering and deletion', async ({ page }) => {
  const requests: Array<{ url: string; key?: string; body: any }> = [];
  const leaks: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173') && !endpoint.test(r.url())) leaks.push(r.url()); });
  await page.route(endpoint, async route => {
    const { body, input, answer } = answerFor(route);
    requests.push({ url: route.request().url(), key: route.request().headers()['authorization'], body });
    if (typeof input.task === 'string' && /\bStudy Guide\b/.test(input.task)) {
      const citationIds = input.sources.slice(0, 13).map((source: { id: string }) => source.id);
      // All 13 IDs exist in this actual generator context. The former local .max(12)
      // rejected this schema-compliant reply even though the wire schema allowed it.
      expect(new Set(citationIds).size).toBe(13);
      answer.title = 'Study Guide mit dreizehn gültigen Belegen';
      answer.blocks = [
        { heading: 'Lernziele und Schlüsselbegriffe', text: 'Die Probe enthält 17 Milligramm Nitrat pro Liter. Vergleiche die Aussagen der bereitgestellten Quellen und prüfe ihre Belege.', citationIds },
        ...[
          ['Selbsttest 1: Was enthält die Probe?', 'Antwort: 17 Milligramm Nitrat pro Liter.'],
          ['Selbsttest 2: Wie prüfst du die Herkunft?', 'Antwort: Öffne den zugeordneten Quellenbeleg.'],
          ['Selbsttest 3: Was bedeutet begrenzte Abdeckung?', 'Antwort: Es wurden ausgewählte Auszüge berücksichtigt.']
        ].map(([heading, text]) => ({ heading, text, citationIds: [citationIds[0]] }))
      ];
    }
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] } });
  });
  await ready(page); await importFiles(page, ['02-wasserlabor.pdf']); await key(page, 'mistral'); await ask(page);
  await expect(page.locator('.chat-message.assistant-message, .chat-message:not(.user-message)').last()).toContainText('17 Milligramm');
  await page.locator('.chat-message .citation').first().click();
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await key(page, 'openrouter'); await ask(page);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].url).toBe('https://api.eu.mistral.ai/v1/chat/completions'); expect(requests[0].key).toBe(`Bearer ${dummyKeys.mistral}`);
  expect(requests[0].body.provider).toBeUndefined(); expect(requests[0].body.model).toBe('mistral-small-2603');
  expect(requests[1].url).toBe('https://openrouter.ai/api/v1/chat/completions'); expect(requests[1].key).toBe(`Bearer ${dummyKeys.openrouter}`);
  expect(requests[1].body.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true });
  for (const request of requests) for (const secret of Object.values(dummyKeys)) expect(JSON.stringify(request.body)).not.toContain(secret);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => /test-only-.*-key/.test(value)))).toBe(false);
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zusammenfassung erstellen', exact: true }).click();
  await expect(page.locator('.coverage-info')).toContainText('1 / 1 Quellen');
  await importFiles(page, ['unicode.txt', 'dangerous.md', 'long-source.txt']);
  await expect(page.locator('.stale-note')).toBeVisible();
  await page.getByRole('button', { name: 'FAQ', exact: true }).click();
  await page.getByRole('button', { name: 'FAQ erstellen', exact: true }).click();
  await expect(page.locator('.coverage-info')).toContainText('4 / 4 Quellen');
  await expect(page.locator('.coverage-info')).toContainText('Begrenzte');
  await page.getByRole('button', { name: 'Lernen', exact: true }).click();
  await page.getByRole('button', { name: 'Study Guide erstellen', exact: true }).click();
  await expect(page.locator('.coverage-info')).toContainText('4 / 4 Quellen');
  await expect(page.locator('.studio-panel')).toContainText('Study Guide mit dreizehn gültigen Belegen');
  await expect(page.getByRole('alert')).toHaveCount(0);
  for (let question = 1; question <= 3; question++) await expect(page.locator('.studio-panel')).toContainText(`Selbsttest ${question}`);
  const routedStudy = requests.at(-1)!;
  expect(routedStudy.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(routedStudy.key).toBe(`Bearer ${dummyKeys.openrouter}`);
  expect(routedStudy.body.provider).toEqual({ data_collection: 'deny', zdr: true, require_parameters: true });
  const studySources = JSON.parse(routedStudy.body.messages.at(-1).content).sources;
  const studyChips = page.locator('.studio-panel .answer-block').first().locator('.citation');
  await expect(studyChips).toHaveCount(13);
  for (let index = 0; index < 13; index++) {
    await studyChips.nth(index).click();
    await expect(page.locator('.source-viewer mark')).toHaveText(studySources[index].text);
  }
  // Persisted Studio content is restored without making another generation request.
  const requestsBeforeReload = requests.length;
  await page.reload();
  await page.getByRole('button', { name: 'Lernen', exact: true }).click();
  await expect(page.locator('.studio-panel')).toContainText('Study Guide mit dreizehn gültigen Belegen');
  await expect(page.locator('.studio-panel .answer-block').first().locator('.citation')).toHaveCount(13);
  expect(requests).toHaveLength(requestsBeforeReload);
  await page.locator('.studio-panel .answer-block').first().locator('.citation').nth(12).click();
  await expect(page.locator('.source-viewer mark')).toHaveText(studySources[12].text);
  // The direct adapter has the same large-context response contract as OpenRouter.
  await key(page, 'mistral');
  await page.getByRole('button', { name: 'Neu generieren', exact: true }).click();
  await expect.poll(() => requests.length).toBe(requestsBeforeReload + 1);
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.studio-panel .answer-block').first().locator('.citation')).toHaveCount(13);
  const directStudy = requests.at(-1)!;
  expect(directStudy.url).toBe('https://api.eu.mistral.ai/v1/chat/completions');
  expect(directStudy.key).toBe(`Bearer ${dummyKeys.mistral}`);
  expect(directStudy.body.provider).toBeUndefined();
  const studioC1 = JSON.parse(requests.at(-1)!.body.messages.at(-1).content).sources[0];
  await page.screenshot({ path: `.cache/verification/${test.info().project.name}-studio.png`, fullPage: true });
  await page.locator('.studio-panel .citation').first().click();
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await page.getByRole('button', { name: 'Nächste Seite' }).click();
  await expect(page.locator('.page-controls')).toContainText('Seite 2 / 2');
  await page.locator('.studio-panel .citation').first().click();
  await expect(page.locator('.page-controls')).toContainText('Seite 1 / 2');
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');
  await ask(page, 'Bei welcher Temperatur lagern die Wasserproben nach der Entnahme?');
  await expect(page.locator('.chat-message:not(.user-message)').last()).toContainText('vier Grad Celsius');
  const chatC1 = JSON.parse(requests.at(-1)!.body.messages.at(-1).content).sources[0];
  expect(studioC1.id).toBe('C1'); expect(chatC1.id).toBe(studioC1.id); expect(chatC1.page).not.toBe(studioC1.page);
  await page.locator('.chat-message:not(.user-message)').last().locator('.citation').click();
  await expect(page.locator('.page-controls')).toContainText('Seite 2 / 2');
  await expect(page.locator('.source-viewer mark')).toContainText('vier Grad Celsius');
  // C1 is reused by this chat response and the frozen Studio result, but maps to different pages/spans.
  await page.locator('.studio-panel .citation').first().click();
  await expect(page.locator('.page-controls')).toContainText('Seite 1 / 2');
  await expect(page.locator('.source-viewer mark')).toContainText('17 Milligramm');

  await page.locator('.source-open').filter({ hasText: 'dangerous.md' }).click();
  await expect(page.locator('.page-text')).toContainText('<img'); expect(await page.locator('.page-text img').count()).toBe(0); expect(leaks).toEqual([]);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.evaluate(() => sessionStorage.setItem('test-only:unrelated', 'keep'));
  await page.locator('.danger-zone').getByRole('button', { name: 'Löschen', exact: true }).click();
  await page.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(page.locator('.source-open')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(name => name.startsWith('researchbench:')))).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('test-only:unrelated'))).toBe('keep');
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(k => /research|transformers/i.test(k)))).toEqual([]);
  await page.reload(); await expect(page.locator('.source-open')).toHaveCount(0);
});

test('invalid citations and quota errors cannot create answers; cancellation drops late responses', async ({ page }) => {
  await ready(page); await importFiles(page, ['02-wasserlabor.pdf']); await key(page, 'mistral');
  await page.route(endpoint, async route => {
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify({ title: 'Ungültig', blocks: [{ text: 'Keine erfundenen Belege.', citationIds: ['invented-citation'] }] }) }, finish_reason: 'stop' }] } });
  });
  await ask(page); await expect(page.getByRole('alert')).toContainText('Quellenverweis');
  expect(await page.locator('.chat-message:not(.user-message)').count()).toBe(0);
  await page.unroute(endpoint); await page.route(endpoint, route => route.fulfill({ headers: cors, status: 429, json: { error: 'dummy' } }));
  await page.getByRole('button', { name: 'Fehler schließen' }).click(); await ask(page);
  await expect(page.getByRole('alert')).toContainText('Rate-Limit');
  await page.unroute(endpoint);
  let release!: () => void;
  let seen = 0;
  let delayed = new Promise<void>(resolve => release = resolve);
  await page.route(endpoint, async route => { seen++; await delayed; await fulfil(route).catch(() => {}); });
  await page.getByRole('button', { name: 'Fehler schließen' }).click();
  await ask(page); await expect.poll(() => seen).toBe(1);
  await page.locator('.progress-banner').getByRole('button', { name: 'Abbrechen' }).click();
  release(); await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(0);

  delayed = new Promise<void>(resolve => release = resolve);
  await ask(page); await expect.poll(() => seen).toBe(2);
  await key(page, 'openrouter'); // Changing the adapter aborts the original provider's job.
  release(); await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(0);

  delayed = new Promise<void>(resolve => release = resolve);
  await ask(page); await expect.poll(() => seen).toBe(3);
  await page.getByRole('button', { name: '02-wasserlabor.pdf löschen', exact: true }).click();
  await page.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  release(); await expect(page.locator('.source-open')).toHaveCount(0);
  await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(0);
  await page.reload(); await expect(page.locator('.source-open')).toHaveCount(0);
  await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(0);
});


test('transient local model failure can be retried through a fresh actual Worker', async ({ page }) => {
  let modelReads = 0;
  await page.route('**/models/*/multilingual-e5-small/onnx/model_quantized.onnx', async route => {
    modelReads++;
    if (modelReads === 1) await route.abort('failed');
    else await route.continue();
  });
  await ready(page);
  await page.locator('#source-upload').setInputFiles(fixture('02-wasserlabor.pdf'));
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.source-open')).toHaveCount(0);
  await expect(page.locator('#source-upload')).toBeEnabled();
  await page.getByRole('button', { name: 'Fehler schließen' }).click();
  await importFiles(page, ['02-wasserlabor.pdf']);
  expect(modelReads).toBe(2);
  await page.getByRole('button', { name: 'Lokale Suche', exact: true }).click();
  await page.locator('#question').fill('Wie hoch ist der Nitratwert?'); await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('17 Milligramm');
});

test('cancel during cold model download publishes no source and a new import succeeds', async ({ page }) => {
  let modelReads = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => release = resolve);
  await page.route('**/models/*/multilingual-e5-small/onnx/model_quantized.onnx', async route => {
    modelReads++;
    if (modelReads === 1) { await held; await route.continue().catch(() => {}); }
    else await route.continue();
  });
  await ready(page);
  await page.locator('#source-upload').setInputFiles(fixture('02-wasserlabor.pdf'));
  await expect.poll(() => modelReads, { timeout: 30_000 }).toBe(1);
  await page.locator('.progress-banner').getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.locator('.source-open')).toHaveCount(0);
  await expect(page.locator('#source-upload')).toBeEnabled();
  release();
  await importFiles(page, ['02-wasserlabor.pdf']);
  expect(modelReads).toBe(2);
  await page.getByRole('button', { name: 'Lokale Suche', exact: true }).click();
  await page.locator('#question').fill('Nitratwert der Wasserprobe'); await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toContainText('17 Milligramm');
});
