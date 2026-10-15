import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generatorContext } from '../../src/lib/context';
import type { Source, Chunk } from '../../src/lib/types';

export const origin = 'http://127.0.0.1:4183';
export const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; };
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function save(name: string, value: unknown) {
  await mkdir('.cache/phase-a', { recursive: true });
  await writeFile(`.cache/phase-a/${name}.json`, JSON.stringify(value, null, 2) + '\n');
}
export async function isolated(browser: Browser) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const external: string[] = [], errors: string[] = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'blob:') return route.continue();
    // Retain only protocol: no unknown URL, query, host, or request headers in reports.
    external.push(url.protocol); return route.abort();
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message.replace(/https?:\/\/[^\s)]+/g, '<url>').replace(/\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+/g, '<path>'))));
  await context.addInitScript(() => {
    // BrowserContext scripts also run in initial opaque about:blank documents.
    if (location.origin !== 'http://127.0.0.1:4183') return;
    localStorage.setItem('researchbench:locale', 'en');
    const state = { gaps: [] as number[], workers: [] as Array<{ type: string; ms: number; chunks?: number }>, cancelVisibleSamples: 0, samples: 0, last: performance.now() };
    (window as any).__capacityObservation = state;
    setInterval(() => {
      const now = performance.now(); state.gaps.push(now - state.last); state.last = now; state.samples++;
      if (document.querySelector('.progress-banner button:not([disabled])')) state.cancelVisibleSamples++;
    }, 25);
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const starts = new Map<number, { type: string; start: number }>();
        const nativePost = this.postMessage.bind(this);
        this.postMessage = ((message: any, transfer?: Transferable[]) => {
          if (message?.type === 'index' || message?.type === 'search') starts.set(message.id, { type: message.type, start: performance.now() });
          return nativePost(message, transfer ?? []);
        }) as typeof this.postMessage;
        this.addEventListener('message', event => {
          const pending = starts.get(event.data?.id);
          if (!pending || (!event.data.result && !event.data.error)) return;
          state.workers.push({ type: pending.type, ms: performance.now() - pending.start, chunks: event.data.result?.chunks?.length });
          starts.delete(event.data.id);
        });
      }
    };
  });
  return { context, external, errors };
}
export async function ready(context: BrowserContext) {
  const page = await context.newPage(); await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  await expect(page.locator('#source-upload')).toBeEnabled(); return page;
}
export async function nextNotebook(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create notebook', exact: true }).first().click();
  await page.locator('#notebook-name').fill(name);
  await page.locator('.notebook-form').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.source-open')).toHaveCount(0);
}
export async function resetObservation(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__capacityObservation;
    s.gaps = []; s.workers = []; s.samples = 0; s.cancelVisibleSamples = 0; s.last = performance.now();
  });
}
export async function observe(page: Page) {
  return page.evaluate(() => {
    const s = (window as any).__capacityObservation;
    const gaps: number[] = s.gaps;
    const ordered = [...gaps].sort((a, b) => a - b);
    return { intervalMs: 25, samples: s.samples, cancelVisibleSamples: s.cancelVisibleSamples,
      maximumHeartbeatGapMs: gaps.length ? Math.max(...gaps) : null,
      p95HeartbeatGapMs: ordered.length ? ordered[Math.floor((ordered.length - 1) * .95)] : null,
      workerOperations: s.workers };
  });
}
export async function memory(page: Page) {
  return page.evaluate(() => {
    const p = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
    return p.memory ? { status: 'available-chromium-nonstandard-main-realm-only', usedJSHeapBytes: p.memory.usedJSHeapSize, totalJSHeapBytes: p.memory.totalJSHeapSize, jsHeapLimitBytes: p.memory.jsHeapSizeLimit }
      : { status: 'unsupported', note: 'No portable total-process/worker/WASM peak memory API is available to this harness.' };
  });
}
export async function stored(page: Page) {
  const notebookId = await page.getByRole('combobox', { name: 'Active notebook' }).inputValue();
  return page.evaluate(async id => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('researchbench-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      const tx = db.transaction(['sources', 'chunks', 'notebooks'], 'readonly');
      const read = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const [allSources, allChunks, notebook] = await Promise.all([read(tx.objectStore('sources').index('notebook').getAll(id)), read(tx.objectStore('chunks').index('notebook').getAll(id)), read(tx.objectStore('notebooks').get(id))]);
      allSources.sort((a, b) => a.name.localeCompare(b.name));
      const order = new Map(allSources.map((s, index) => [s.id, index]));
      allChunks.sort((a, b) => order.get(a.sourceId)! - order.get(b.sourceId)! || a.page - b.page || a.start - b.start);
      const estimate = await navigator.storage.estimate();
      return { schemaVersion: db.version, revision: notebook.revision,
        rawOriginalBytes: allSources.reduce((n, s) => n + s.original.size, 0),
        sources: allSources.map(({ original: _original, ...source }) => source),
        chunks: allChunks.map(({ vector, ...chunk }) => ({ ...chunk, vectorDimensions: vector.length, vectorFinite: Array.from(vector as Float32Array).every(Number.isFinite) })),
        storageEstimate: { usage: estimate.usage ?? null, quota: estimate.quota ?? null, usageDetails: (estimate as any).usageDetails ?? null },
        cacheNames: (await caches.keys()).filter(name => /research|transformers/i.test(name)),
      };
    } finally { db.close(); }
  }, notebookId);
}
export function projection(data: Awaited<ReturnType<typeof stored>>) {
  const canonicalPages = data.sources.flatMap(source => source.pages.map((page: any) => page.text));
  const canonicalChunks = data.chunks.map(chunk => chunk.text);
  // Use the unchanged Studio generator with the actual persisted page/chunk inputs.
  // This inspects its selected context without a key, provider request, or model generation.
  const context = generatorContext(data.sources as Source[], data.chunks as unknown as Chunk[]);
  return {
    schemaVersion: data.schemaVersion, sourceCount: data.sources.length, chunkCount: data.chunks.length,
    canonicalPagesHash: hash(canonicalPages), canonicalChunksHash: hash(canonicalChunks),
    characters: canonicalPages.reduce((n, text) => n + Array.from(text).length, 0),
    originalBytes: data.rawOriginalBytes, storageEstimate: data.storageEstimate, cacheNames: data.cacheNames,
    vectors: { dimensions: [...new Set(data.chunks.map(chunk => chunk.vectorDimensions))], finite: data.chunks.every(chunk => chunk.vectorFinite), versions: [...new Set(data.chunks.map(chunk => chunk.embeddingVersion))] },
    studio: { method: 'actual generatorContext(persisted sources, persisted chunks), no provider call', coverage: context.coverage,
      selectedTextHash: hash(context.citations.map(c => c.text)),
      citations: context.citations.map(c => ({ id: c.id, sourceName: c.sourceName, page: c.page, start: c.start, end: c.end, text: c.text })),
    },
  };
}
export async function importAndWait(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>, count: number) {
  await page.locator('#source-upload').setInputFiles(files);
  await page.waitForFunction(() => !!document.querySelector('[role="alert"]') || !document.querySelector('.progress-banner'), null, { timeout: 600_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.source-open')).toHaveCount(count);
  await expect(page.getByRole('alert')).toHaveCount(0);
}
