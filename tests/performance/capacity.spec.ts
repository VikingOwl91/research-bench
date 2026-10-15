import { captureIdentity } from './identity.mjs';
import { test, expect, type Page } from '@playwright/test';
import { platform, arch, cpus, totalmem } from 'node:os';
import { corpus, questions } from './corpus';
import { hash, importAndWait, isolated, median, memory, nextNotebook, observe, projection, ready, resetObservation, save, stored } from './support';

async function search(page: Page, question: typeof questions[number], phase: string) {
  const before = await page.evaluate(() => (window as any).__capacityObservation.workers.filter((w: any) => w.type === 'search').length);
  await page.locator('#question').fill(question.question);
  const started = await page.evaluate(() => performance.now());
  await page.locator('#question').press('Enter');
  await expect.poll(() => page.evaluate(() => (window as any).__capacityObservation.workers.filter((w: any) => w.type === 'search').length), { timeout: 180_000 }).toBe(before + 1);
  await expect(page.locator('.progress-banner')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const uiReadyMs = await page.evaluate(start => performance.now() - start, started);
  const results = await page.locator('.search-result').allTextContents();
  const rank = results.findIndex(text => text.replace(/\s+/g, ' ').includes(question.expected)) + 1;
  expect(results).toHaveLength(6);
  expect(rank, `Expected fact absent from top 6 for ${question.language}: ${question.question}`).toBeGreaterThan(0);
  const workerMs = await page.evaluate(() => (window as any).__capacityObservation.workers.filter((w: any) => w.type === 'search').at(-1).ms);
  return { phase, language: question.language, question: question.question, expected: question.expected, expectedRank: rank, topK: 6, workerMs, uiReadyMs, resultTextHashes: results.map(hash) };
}

test('Phase A: equal canonical corpus at 10 vs 50 sources, balanced real-browser measurements', async ({ browser }, info) => {
  const report: any = {
    formatVersion: 1, buildIdentity: captureIdentity(), browser: info.project.name, browserVersion: browser.version(),
    environment: { osFamily: platform(), architecture: arch(), logicalCPUs: cpus().length, totalMemoryBytes: totalmem() },
    productionBuild: true, providerCalls: 0, retries: 0,
    limitsExpected: { sources: 50, fileBytes: 10 * 1024 * 1024, characters: 500_000, chunks: 1000, contextCharacters: 24_000, schema: 2 },
    workload: { license: 'CC0 original fictional corpus', pages: 50, partition: '10 files x 5 pages vs 50 files x 1 page', querySet: questions, warmQueryRepeats: 3, rounds: 2, balancedOrder: [[10, 50], [50, 10]] },
    timingNotes: [
      'Index UI-ready time includes Playwright file transfer, real PDFium parse, real multilingual E5 embeddings, IndexedDB transaction, controller refresh and UI update.',
      'Cold means fresh browser context with empty CacheStorage/IndexedDB. Warm-assets means a new notebook in the same context after the first trial and deletion of that trial notebook; worker initialization may recur. Request routing disables HTTP cache in Playwright.',
      'Reload first-search includes a new worker and cached assets when retained. Warm query medians are repeated actual searches after that first search.',
      'Heartbeat is a 25ms main-window timer; it observes event-loop stalls but is not a full tracing profiler. Memory values are observations, not total process/WASM/worker peak memory.',
      'No fixed latency acceptance threshold is inferred from one machine. Storage estimates are browser quota observations, not an aggregate-byte guarantee.',
    ], trials: [], externalRequests: [], pageErrors: [], status: 'running',
  };
  try {
    for (const [round, order] of [[10, 50], [50, 10]].entries()) {
      const { context, external, errors } = await isolated(browser);
      try {
        const page = await ready(context);
        for (const [position, sourceCount] of order.entries()) {
          if (position) {
            await page.getByRole('button', { name: 'Delete notebook', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently', exact: true }).click();
            await expect(page.locator('.source-open')).toHaveCount(0);
            await nextNotebook(page, `Capacity round ${round + 1} trial ${position + 1}`);
          }
          const files = corpus(sourceCount as 10 | 50);
          const before = await memory(page);
          const storageBefore = (await stored(page)).storageEstimate;
          await resetObservation(page);
          const started = await page.evaluate(() => performance.now());
          await importAndWait(page, files, sourceCount);
          const indexUiReadyMs = await page.evaluate(start => performance.now() - start, started);
          const responsiveness = await observe(page);
          const persisted = projection(await stored(page));
          expect(persisted.schemaVersion).toBe(2);
          expect(persisted.chunkCount).toBe(50);
          expect(persisted.vectors.dimensions).toEqual([384]);
          expect(persisted.vectors.finite).toBe(true);
          expect(persisted.studio.coverage.limited).toBe(true);
          expect(persisted.studio.coverage.selectedCharacters).toBeLessThanOrEqual(24_000);
          const indexWorkerMs = responsiveness.workerOperations.filter((w: any) => w.type === 'index').reduce((n: number, w: any) => n + w.ms, 0);
          const trial: any = { round: round + 1, position: position + 1, sourceCount,
            temperature: position ? 'warm-assets-new-notebook' : 'cold-context',
            indexUiReadyMs, indexWorkerMs, chunksPerSecondUi: 50 / (indexUiReadyMs / 1000), chunksPerSecondWorker: 50 / (indexWorkerMs / 1000),
            importBytes: files.reduce((n, file) => n + file.buffer.length, 0),
            storageEstimateBeforeIndex: storageBefore, responsiveness, memory: { beforeIndex: before, afterIndex: await memory(page) }, persisted, searches: [] };
          report.trials.push(trial);
          await save(`${info.project.name}-capacity`, report);
          await page.getByRole('button', { name: 'Local search', exact: true }).click();
          trial.searches.push(await search(page, questions[0], 'after-index-worker-warm'));
          const reloadStarted = performance.now(); await page.reload();
          await expect(page.locator('.source-open')).toHaveCount(sourceCount);
          await expect(page.locator('.progress-banner')).toHaveCount(0);
          trial.reloadUiReadyMs = performance.now() - reloadStarted;
          const reloaded = projection(await stored(page));
          expect(reloaded.canonicalPagesHash).toBe(persisted.canonicalPagesHash);
          expect(reloaded.canonicalChunksHash).toBe(persisted.canonicalChunksHash);
          expect(reloaded.originalBytes).toBe(persisted.originalBytes);
          trial.reloadStorageEstimate = reloaded.storageEstimate;
          await page.getByRole('button', { name: 'Local search', exact: true }).click();
          trial.searches.push(await search(page, questions[0], 'reload-first-search-worker-cold'));
          for (let repeat = 0; repeat < 3; repeat++) {
            // Rotate EN/DE query order to avoid always associating a question with first position.
            const ordered = [...questions.slice(repeat % questions.length), ...questions.slice(0, repeat % questions.length)];
            for (const question of ordered) trial.searches.push({ ...await search(page, question, 'warm-search'), repeat: repeat + 1 });
          }
          const warm = trial.searches.filter((entry: any) => entry.phase === 'warm-search');
          trial.warmSearchMedianMs = { worker: median(warm.map((e: any) => e.workerMs)), uiReady: median(warm.map((e: any) => e.uiReadyMs)) };
          trial.memory.afterSearch = await memory(page);
          await save(`${info.project.name}-capacity`, report);
        }
        // A real click exercises the cancellation boundary on a separate disposable notebook.
        if (round === 1) {
          await nextNotebook(page, 'Cancellation readiness probe');
          await resetObservation(page);
          await page.locator('#source-upload').setInputFiles(corpus(50));
          const cancel = page.locator('.progress-banner').getByRole('button', { name: 'Cancel', exact: true });
          await expect(cancel).toBeVisible();
          const started = await page.evaluate(() => performance.now()); await cancel.click();
          await expect(page.locator('.progress-banner')).toHaveCount(0);
          const cancelToReadyMs = await page.evaluate(start => performance.now() - start, started);
          const immediate = await stored(page);
          await page.waitForTimeout(500);
          const settled = await stored(page);
          expect(settled.sources.length).toBe(immediate.sources.length);
          expect(settled.chunks.length).toBe(immediate.chunks.length);
          report.cancellation = { cancelToReadyMs, committedSourcesAtReady: immediate.sources.length, committedChunksAtReady: immediate.chunks.length, noLateWritesObservationMs: 500, noLateWrites: true, responsiveness: await observe(page) };
        }
      } finally {
        report.externalRequests.push(...external); report.pageErrors.push(...errors); await context.close();
      }
    }
    expect(new Set(report.trials.map((trial: any) => trial.persisted.canonicalPagesHash)).size).toBe(1);
    expect(new Set(report.trials.map((trial: any) => trial.persisted.canonicalChunksHash)).size).toBe(1);
    expect(report.externalRequests).toEqual([]); expect(report.pageErrors).toEqual([]);
    report.mediansBySourceCount = [10, 50].map(sourceCount => {
      const trials = report.trials.filter((trial: any) => trial.sourceCount === sourceCount);
      return { sourceCount, samples: trials.length,
        indexUiReadyMs: median(trials.map((t: any) => t.indexUiReadyMs)), indexWorkerMs: median(trials.map((t: any) => t.indexWorkerMs)),
        reloadUiReadyMs: median(trials.map((t: any) => t.reloadUiReadyMs)), warmSearchWorkerMs: median(trials.map((t: any) => t.warmSearchMedianMs.worker)),
        warmSearchUiReadyMs: median(trials.map((t: any) => t.warmSearchMedianMs.uiReady)),
      };
    });
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = 'A required browser assertion failed; inspect the test runner output. Partial metrics remain evidence only.'; throw error; }
  finally { await save(`${info.project.name}-capacity`, report); }
});
