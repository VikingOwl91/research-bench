import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { alternatingPaintPdf, paintModePages } from '../fixtures/pdf-provenance.mjs';
import type { PageText } from '#lib/types.ts';

// Extraction provenance in the source viewer (RB-RT-005, RB-RT-008):
// Non-painting/near-white PDF text stays searchable, with qualified provenance;
// PDFs with graphic-only pages surface an extraction-coverage notice.

const fixture = (name: string) => resolve('tests/fixtures', name);

// Match the application's once-per-worker Pdfium lifetime. Reinitializing the
// Emscripten binding while Rust owns the previous instance is not supported.
let pdfParser: Promise<{ parse_pdf(bytes: Uint8Array): PageText[] }> | undefined;
function fixtureParser() {
  return pdfParser ??= (async () => {
    const rust = await import(pathToFileURL(resolve('src/lib/wasm/research_core.js')).href);
    const exports = rust.initSync({ module: await readFile(resolve('src/lib/wasm/research_core_bg.wasm')) });
    const { default: pdfium } = await import(pathToFileURL(resolve('static/pdfium/pdfium.js')).href);
    const module = await pdfium({ wasmBinary: await readFile(resolve('static/pdfium/pdfium.wasm')), print: () => {}, printErr: () => {} });
    expect(rust.initialize_pdfium_render(module, exports, false)).toBe(true);
    return rust;
  })();
}


async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}
async function upload(page: import('@playwright/test').Page, name: string) {
  await page.locator('#source-upload').setInputFiles(fixture(name));
  await expect(page.locator('.source-open').filter({ hasText: name })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
}

test('invisible and white PDF text is indexed, searchable and marked in the viewer', async ({ page }) => {
  await ready(page);
  await upload(page, '04-hidden-text.pdf');
  // The hidden payloads are part of the extracted, indexed text.
  await page.getByRole('button', { name: 'Local search', exact: true }).click();
  await page.locator('#question').fill('Gigawatt Produktion Park behaupten');
  await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toBeVisible({ timeout: 180_000 });
  const hit = await page.locator('.search-result').first().textContent();
  expect(hit).toContain('UNSICHTBARER_INJECTION_TEXT');
  // The viewer marks both hidden spans and explains the marking.
  await page.locator('.source-open').first().click();
  await expect(page.locator('.page-text')).toBeVisible();
  await expect(page.locator('.page-text .pdf-hidden-text')).toHaveCount(2);
  const hiddenTexts = await page.locator('.page-text .pdf-hidden-text').allTextContents();
  expect(hiddenTexts.join(' ')).toContain('UNSICHTBARER_INJECTION_TEXT');
  expect(hiddenTexts.join(' ')).toContain('WEISSER_GEHEIMER_TEXT');
  await expect(page.locator('.hidden-text-legend')).toContainText('these markers do not determine actual visibility');
  // Visible text is not marked.
  const pageText = await page.locator('.page-text').textContent();
  expect(pageText).toContain('sichtbarer Text ueber fiktive Solarmodule');
  // The extraction-coverage notice is absent for a fully text-based PDF.
  await expect(page.locator('.source-notice').filter({ hasText: 'Pages without extractable text' })).toHaveCount(0);
});

test('PDFs with graphic-only pages surface an extraction-coverage notice', async ({ page }) => {
  await ready(page);
  await upload(page, '05-mixed-pages.pdf');
  await page.locator('.source-open').first().click();
  await expect(page.locator('.page-text')).toContainText('Text auf Seite eins');
  await expect(page.locator('.source-notice').filter({ hasText: 'Pages without extractable text: 1 of 2' })).toBeVisible();
  // Navigating to the textless page keeps the notice and shows the empty-page state.
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.source-notice').filter({ hasText: 'Pages without extractable text: 1 of 2' })).toBeVisible();
  // No hidden-text legend on a PDF without hidden spans.
  await expect(page.locator('.hidden-text-legend')).toHaveCount(0);
});


test('paint-mode provenance covers clipping and transparency without mislabelling visible outlines', async ({ page }) => {
  await ready(page);
  await upload(page, '06-paint-modes.pdf');
  await page.locator('.source-open').first().click();
  for (let index = 0; index < paintModePages.length; index++) {
    const expected = paintModePages[index];
    await expect(page.locator('.page-text')).toHaveText(expected.text);
    await expect(page.locator('.page-text .pdf-hidden-text')).toHaveCount(expected.marked ? 1 : 0);
    if (expected.marked) {
      await expect(page.locator('.hidden-text-legend')).toContainText('Near-white text may be visible against its background');
      await expect(page.locator('.hidden-text-legend')).not.toContainText('not visible in the original');
    } else await expect(page.locator('.hidden-text-legend')).toHaveCount(0);
    if (index < paintModePages.length - 1) await page.getByRole('button', { name: 'Next page', exact: true }).click();
  }
  await page.getByLabel('Interface language', { exact: true }).selectOption('de');
  await expect(page.locator('.hidden-text-legend')).toContainText('diese Markierungen bestimmen nicht die tatsächliche Sichtbarkeit');
});

for (const spanCount of [5_000, 50_000]) test(`${spanCount} parser-produced spans use bounded markup and preserve all text and the citation`, async ({ page }, testInfo) => {
  // Isolate main-thread viewer cost from embedding: parse a real, valid PDF with
  // the shipped Rust/Pdfium bindings, then seed its unmodified pages locally.
  const rust = await fixtureParser();
  const bytes = alternatingPaintPdf(spanCount);
  const pages = rust.parse_pdf(bytes);
  expect(bytes.length).toBeLessThan(10 * 1024 * 1024);
  expect(pages[0].hiddenSpans).toHaveLength(spanCount);
  expect(pages[0].text.length).toBeLessThan(500_000);
  await ready(page);
  const citationText = pages[0].text.slice(-20);
  await page.evaluate(async ({ pages, size }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('researchbench-v1');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['notebooks', 'sources', 'messages'], 'readwrite');
        const notebooks = tx.objectStore('notebooks').getAll();
        notebooks.onsuccess = () => {
          const notebook = notebooks.result[0];
          const sourceId = 'viewer-scale-regression', name = 'alternating-paint.pdf';
          tx.objectStore('sources').put({ id: sourceId, notebookId: notebook.id, name, kind: 'pdf', size,
            createdAt: Date.now(), parser: 'pdfium-rust-wasm', original: new Blob(), pages, chunkCount: 0 });
          const text = pages[0].text, end = text.length, start = end - 20;
          tx.objectStore('messages').put({ id: 'viewer-scale-answer', notebookId: notebook.id, revision: notebook.revision,
            createdAt: Date.now(), role: 'assistant', text: 'Source-viewer performance fixture.',
            answer: { title: 'Source-viewer fixture', blocks: [{ text: 'Source-viewer performance fixture.', citationIds: ['C1'] }] },
            citations: [{ id: 'C1', sourceId, sourceName: name, page: 1, start, end, text: text.slice(start, end) }] });
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { pages, size: bytes.length });
  await page.reload();
  const citation = page.locator('.citation').filter({ hasText: 'alternating-paint.pdf' });
  await expect(citation).toBeVisible();
  await page.evaluate(() => {
    const state = { last: performance.now(), maxGap: 0, timer: 0 };
    state.timer = window.setInterval(() => { const now = performance.now(); state.maxGap = Math.max(state.maxGap, now - state.last); state.last = now; }, 20);
    (window as any).__viewerBenchmark = state;
  });
  const started = performance.now();
  await citation.click();
  await expect(page.locator('.page-text')).toHaveText(pages[0].text);
  expect(await page.locator('.page-text').textContent()).toBe(pages[0].text);
  await expect(page.locator('.page-text mark')).toHaveText(citationText);
  await expect(page.locator('.provenance-limit-notice')).toContainText('individual rendering markers are omitted');
  await expect(page.locator('.page-text .pdf-hidden-text')).toHaveCount(0);
  expect(await page.locator('.page-text').evaluate(node => node.childElementCount)).toBe(1);
  await page.waitForTimeout(100);
  const benchmark = await page.evaluate(() => {
    const state = (window as any).__viewerBenchmark;
    window.clearInterval(state.timer);
    return { maxMainThreadGapMs: state.maxGap };
  });
  const evidence = { browser: testInfo.project.name, spans: spanCount, elapsedMs: performance.now() - started, ...benchmark };
  await testInfo.attach('viewer-benchmark.json', { body: JSON.stringify(evidence), contentType: 'application/json' });
  console.info('Source-viewer benchmark:', JSON.stringify(evidence));
  expect(benchmark.maxMainThreadGapMs).toBeLessThan(2_000);
  await page.getByLabel('Interface language', { exact: true }).selectOption('de');
  await expect(page.locator('.provenance-limit-notice')).toContainText('einzelne Darstellungsmarkierungen entfallen');
  await expect(page.locator('.page-text')).toHaveText(pages[0].text);
  expect(await page.locator('.page-text').textContent()).toBe(pages[0].text);
  await expect(page.locator('.page-text mark')).toHaveText(citationText);
});
