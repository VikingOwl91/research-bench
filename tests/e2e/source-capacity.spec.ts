import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMBEDDING_VERSION } from '../../src/lib/constants';

const smallFile = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from('Fictional capacity check: the observatory opens on Monday morning.') });

async function observeImports(page: Page) {
  await page.addInitScript(() => {
    const target = window as any;
    target.capacityReads = []; target.capacityIndexes = 0; target.holdCapacityIndex = false; target.heldCapacityIndexes = [];
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () { target.capacityReads.push(this.name); return read.call(this); };
    const NativeWorker = Worker;
    target.Worker = class extends NativeWorker {
      override postMessage(value: any, options?: any) {
        if (value?.type === 'index') {
          target.capacityIndexes++;
          if (target.holdCapacityIndex) { target.heldCapacityIndexes.push(() => super.postMessage(value, options)); return; }
        }
        super.postMessage(value, options);
      }
    };
    target.releaseCapacityIndexes = () => {
      target.holdCapacityIndex = false;
      for (const release of target.heldCapacityIndexes.splice(0)) release();
    };
  });
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}

// Seed only the count/UI fixtures in native IndexedDB. Final-slot imports below
// still use the real parser, embedding worker, controller and write transaction.
async function seed(page: Page, count: number) {
  const notebookId = await page.getByRole('combobox', { name: 'Active notebook', exact: true }).inputValue();
  await page.evaluate(async ({ notebookId, count, embeddingVersion }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('researchbench-v1', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['notebooks', 'sources', 'chunks'], 'readwrite');
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
        // This disposable test context has one notebook. Clear requests precede
        // seeding, so a live cursor cannot accidentally visit newly inserted rows.
        tx.objectStore('sources').clear(); tx.objectStore('chunks').clear();
        const request = tx.objectStore('notebooks').get(notebookId);
        request.onsuccess = () => {
          const notebook = request.result; notebook.revision++; tx.objectStore('notebooks').put(notebook);
          for (let index = 0; index < count; index++) {
            const id = `capacity-${index}`, text = `Fictional source ${index}: this record exists to exercise notebook capacity.`;
            const name = index === count - 1 ? `capacity-${index}-a-long-source-name-with-words-that-must-wrap-on-small-screens.txt` : `capacity-${index}.txt`;
            tx.objectStore('sources').put({ id, notebookId, name, kind: 'txt', size: text.length, createdAt: index, parser: 'capacity-fixture', original: new Blob([text]), pages: [{ page: 1, text }], chunkCount: 1 });
            const vector = new Float32Array(384); vector[0] = 1;
            tx.objectStore('chunks').put({ id: `${id}:1`, notebookId, sourceId: id, page: 1, start: 0, end: text.length, text, vector, embeddingVersion });
          }
        };
      });
    } finally { db.close(); }
  }, { notebookId, count, embeddingVersion: EMBEDDING_VERSION });
  await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
  await expect(page.locator('.source-open')).toHaveCount(count);
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('researchbench-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ version: number; sourceIds: string[]; chunkSourceIds: string[]; revision: number }>((resolve, reject) => {
        const tx = db.transaction(['sources', 'chunks', 'notebooks']);
        const sources = tx.objectStore('sources').getAll(), chunks = tx.objectStore('chunks').getAll(), notebooks = tx.objectStore('notebooks').getAll();
        tx.oncomplete = () => resolve({ version: db.version, sourceIds: sources.result.map(s => s.id).sort(), chunkSourceIds: chunks.result.map(c => c.sourceId).sort(), revision: notebooks.result[0].revision });
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}

async function deleteFirst(page: Page) {
  await page.locator('.source-remove').first().click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.locator('.source-open')).toHaveCount(49);
}

// Delay delivery of one native IndexedDB success event, not the transaction.
// Its captured 50-source result can then finish after a newer 49-source read.
async function observeRefreshes(page: Page) {
  await page.addInitScript(() => {
    const target = window as any;
    target.holdNextSources = false; target.heldSources = [];
    const held = new WeakSet<IDBRequest>();
    const getAll = IDBIndex.prototype.getAll, listen = EventTarget.prototype.addEventListener;
    IDBIndex.prototype.getAll = function (...args) {
      const request = getAll.apply(this, args);
      if (this.objectStore.name === 'sources' && target.holdNextSources) {
        target.holdNextSources = false; held.add(request);
      }
      return request;
    };
    EventTarget.prototype.addEventListener = function (type, callback, options) {
      if (this instanceof IDBRequest && held.has(this) && type === 'success' && callback) {
        const request = this;
        return listen.call(this, type, event => {
          target.heldSources.push(() => typeof callback === 'function' ? callback.call(request, event) : callback.handleEvent(event));
        }, options);
      }
      return listen.call(this, type, callback, options);
    };
  });
}

test('capacity, sequential overflow accounting, full drops, deletion and reopening use real browser storage', async ({ page }) => {
  await observeImports(page); await ready(page);
  await expect(page.locator('.count-badge')).toHaveText('0 / 50');
  await expect(page.locator('#source-capacity-note')).toHaveText('50 source slots available.');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add sources', exact: true }).click();
  await (await chooser).setFiles(smallFile('first.txt'));
  await expect(page.locator('.source-open')).toHaveCount(1, { timeout: 180_000 });
  await expect(page.locator('.import-report')).toContainText('Imported: 1');
  await page.locator('#source-upload').setInputFiles([smallFile('invalid.exe'), smallFile('not-attempted.txt')]);
  await expect(page.locator('.import-report')).toContainText('Imported: 0 · Failed: 1 · Canceled: 0 · Not attempted: 1');
  expect(await page.evaluate(() => (window as any).capacityReads)).not.toContain('not-attempted.txt');
  await expect(page.locator('.source-open')).toHaveCount(1);
  await seed(page, 49);
  await expect(page.locator('#source-capacity-note')).toHaveText('One source slot remains.');
  await page.locator('#source-upload').setInputFiles([smallFile('last-slot.txt'), smallFile('excess.txt')]);
  await expect(page.locator('.source-open')).toHaveCount(50);
  await expect(page.locator('.import-report')).toContainText('Imported: 1 · Failed: 0 · Canceled: 0 · Not attempted: 1');
  await expect(page.locator('.import-warning')).toContainText('Selected files: 2. Available source slots at batch start: 1.');
  const observed = await page.evaluate(() => ({ reads: (window as any).capacityReads, indexes: (window as any).capacityIndexes }));
  expect(observed.reads).not.toContain('excess.txt'); expect(observed.indexes).toBe(2);
  await expect(page.getByRole('button', { name: 'Add sources', exact: true })).toBeDisabled();
  await expect(page.locator('#source-upload')).toBeDisabled();
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  const before = await stored(page);
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['Must not be read.'], 'full-drop.txt')); return data; });
  await page.locator('.dropzone').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('.import-report')).toContainText('full-drop.txt');
  await expect(page.locator('.import-report')).toContainText('Not attempted: 1');
  expect(await stored(page)).toEqual(before);
  expect(await page.evaluate(() => (window as any).capacityReads)).not.toContain('full-drop.txt');
  await page.locator('#interface-language').selectOption('de');
  await expect(page.locator('.count-badge')).toHaveAccessibleName('50 / 50 Quellen');
  await expect(page.locator('#source-capacity-note')).toContainText('Notebook voll');
  await expect(page.locator('.import-report')).toContainText('Nicht versucht: 1');
  await page.locator('#interface-language').selectOption('en');
  await deleteFirst(page);
  await expect(page.getByRole('button', { name: 'Add sources', exact: true })).toBeEnabled();
  await page.locator('#source-upload').setInputFiles(smallFile('replacement.txt'));
  await expect(page.locator('.source-open')).toHaveCount(50);
  const after = await stored(page);
  expect(after.sourceIds).not.toContain('capacity-0'); expect(after.chunkSourceIds).not.toContain('capacity-0');
  expect(after.version).toBe(2);
  await page.reload();
  await expect(page.locator('.source-open')).toHaveCount(50);
  await expect(page.locator('.count-badge')).toHaveText('50 / 50');
  expect(await stored(page)).toEqual(after);
});

test('two tabs compete for the final slot and an explicit refresh recovers from an external deletion', async ({ page, context }) => {
  await observeImports(page); await ready(page); await seed(page, 49);
  const other = await context.newPage(); await observeImports(other); await ready(other);
  await expect(other.locator('.source-open')).toHaveCount(49);
  for (const tab of [page, other]) await tab.evaluate(() => (window as any).holdCapacityIndex = true);
  await page.locator('#source-upload').setInputFiles(smallFile('tab-a.txt'));
  await other.locator('#source-upload').setInputFiles(smallFile('tab-b.txt'));
  for (const tab of [page, other]) await expect.poll(() => tab.evaluate(() => (window as any).heldCapacityIndexes.length)).toBe(1);
  await Promise.all([page.evaluate(() => (window as any).releaseCapacityIndexes()), other.evaluate(() => (window as any).releaseCapacityIndexes())]);
  await expect.poll(async () => (await stored(page)).sourceIds.length, { timeout: 180_000 }).toBe(50);
  for (const tab of [page, other]) await expect(tab.locator('.progress-banner')).toHaveCount(0, { timeout: 180_000 });
  const winner = await page.locator('.source-open').count() === 50 ? page : other;
  const loser = winner === page ? other : page;
  await expect(loser.locator('.import-report')).toContainText('Imported: 0 · Failed: 1');
  expect((await stored(page)).chunkSourceIds).toEqual((await stored(page)).sourceIds);
  await loser.getByRole('button', { name: 'Refresh sources', exact: true }).click();
  await expect(loser.locator('.count-badge')).toHaveText('50 / 50');
  await expect(loser.getByRole('button', { name: 'Add sources', exact: true })).toBeDisabled();
  await deleteFirst(winner);
  await expect(loser.locator('.count-badge')).toHaveText('50 / 50'); // Deliberately stale, no automatic synchronization.
  await loser.getByRole('button', { name: 'Refresh sources', exact: true }).click();
  await expect(loser.locator('.count-badge')).toHaveText('49 / 50');
  await loser.locator('#source-upload').setInputFiles(smallFile('after-refresh.txt'));
  await expect(loser.locator('.source-open')).toHaveCount(50);
  expect((await stored(page)).sourceIds).toHaveLength(50);
});

test('an older 50-source refresh cannot overwrite a newer 49-source refresh or disable imports', async ({ page, context }) => {
  await observeRefreshes(page); await ready(page); await seed(page, 50);
  const other = await context.newPage(); await ready(other);
  await expect(other.locator('.count-badge')).toHaveText('50 / 50');
  const refresh = page.getByRole('button', { name: 'Refresh sources', exact: true });
  await page.evaluate(() => (window as any).holdNextSources = true);
  await refresh.click();
  await expect.poll(() => page.evaluate(() => (window as any).heldSources.length)).toBe(1);
  await deleteFirst(other);
  await refresh.click(); await expect(page.locator('.count-badge')).toHaveText('49 / 50');
  const fresh = await stored(page);
  await page.evaluate(async () => {
    for (const release of (window as any).heldSources.splice(0)) release();
    // Resolve the IDB-backed promises and flush their UI update before asserting.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(page.locator('.count-badge')).toHaveText('49 / 50');
  await expect(page.locator('.source-open')).toHaveCount(49);
  const add = page.getByRole('button', { name: 'Add sources', exact: true });
  await expect(add).toBeEnabled(); expect(await stored(page)).toEqual(fresh);
  // A stale revision would reject this real chooser import despite 49 rows.
  const chooser = page.waitForEvent('filechooser'); await add.click();
  await (await chooser).setFiles(smallFile('after-overlap.txt'));
  await expect(page.locator('.source-open')).toHaveCount(50, { timeout: 180_000 });
  await expect(page.locator('.import-report')).toContainText('Imported: 1 · Failed: 0');
  const after = await stored(page);
  expect(after.revision).toBe(fresh.revision + 1); expect(after.sourceIds).toHaveLength(50);
});

test('fifty source rows and capacity controls remain accessible in both languages and themes on narrow screens', async ({ page }, info) => {
  await ready(page); await seed(page, 50);
  for (const language of ['en', 'de']) {
    await page.locator('#interface-language').selectOption(language);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }, theme);
      for (const width of [320, 375, 430, 768]) {
        await page.setViewportSize({ width, height: 740 });
        await page.locator('.mobile-navigation button').first().click();
        await expect(page.locator('.count-badge')).toHaveText('50 / 50');
        const refresh = page.getByRole('button', { name: language === 'en' ? 'Refresh sources' : 'Quellen aktualisieren', exact: true });
        await refresh.focus(); await expect(refresh).toBeInViewport();
        if (width === 375) await page.screenshot({ path: `.cache/phase-a/${info.project.name}-${language}-${theme}-375-top.png`, fullPage: false });
        await page.locator('.source-open').last().focus(); await expect(page.locator('.source-open').last()).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        if (width === 375) await page.screenshot({ path: `.cache/phase-a/${info.project.name}-${language}-${theme}-375.png`, fullPage: false });
        if (width === 375 || width === 768) {
          await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'));
          const violations = await page.evaluate(async () => (window as any).axe.run('#sources-panel', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }).then((r: any) => r.violations.map((v: any) => ({ id: v.id, targets: v.nodes.map((n: any) => n.target) }))));
          expect(violations, `${language}/${theme}/${width}px`).toEqual([]);
        }
      }
    }
  }
});
