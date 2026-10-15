import { captureIdentity } from './identity.mjs';
import { test, expect } from '@playwright/test';
import { pages, pdf } from './corpus';
import { isolated, memory, observe, projection, ready, resetObservation, save, stored } from './support';

// Deliberately separate from the equal-corpus comparison. Run explicitly with CAPACITY_HIGH_BYTES=1.
// One file at a time avoids creating and transporting a 500MiB JS upload array.
test('Phase A high-original-byte observation: up to 50 valid near-10MiB PDFs', async ({ browser }, info) => {
  const fileBytes = 10 * 1024 * 1024 - 1024;
  const report: any = { formatVersion: 1, buildIdentity: captureIdentity(), browser: info.project.name, browserVersion: browser.version(),
    scenario: '50 individually uploaded valid PDFs with small text and large unreferenced stream',
    targetSources: 50, fileBytes, targetOriginalBytes: 50 * fileBytes,
    aggregateBytesGuaranteed: false, providerCalls: 0, samples: [], status: 'running' };
  const { context, external, errors } = await isolated(browser);
  try {
    const page = await ready(context); await resetObservation(page);
    report.before = { storage: projection(await stored(page)), memory: await memory(page) };
    for (let index = 0; index < 50; index++) {
      const before = await stored(page);
      const start = performance.now();
      await page.locator('#source-upload').setInputFiles({ name: `high-original-${String(index + 1).padStart(2, '0')}.pdf`, mimeType: 'application/pdf', buffer: pdf([pages[index]], fileBytes) });
      await page.waitForFunction(() => !!document.querySelector('[role="alert"]') || !document.querySelector('.progress-banner'), null, { timeout: 600_000 });
      const after = await stored(page);
      const alert = await page.getByRole('alert').allTextContents();
      report.samples.push({ attemptedSource: index + 1, importUiReadyMs: performance.now() - start,
        acceptedSources: after.sources.length, acceptedChunks: after.chunks.length, originalBytes: after.rawOriginalBytes,
        storageEstimate: after.storageEstimate, memory: await memory(page), alert });
      await save(`${info.project.name}-high-bytes`, report);
      if (alert.length) {
        // This is an observed browser failure, not a promise that all 500MiB fits.
        expect(after.sources.length).toBe(before.sources.length);
        expect(after.chunks.length).toBe(before.chunks.length);
        expect(after.rawOriginalBytes).toBe(before.rawOriginalBytes);
        expect(after.revision).toBe(before.revision);
        report.failureRollbackVerified = true;
        report.outcome = 'browser-rejected-import-with-prior-records-preserved';
        break;
      }
      expect(after.sources.length).toBe(index + 1);
      expect(after.chunks.length).toBe(index + 1);
      expect(after.rawOriginalBytes).toBe((index + 1) * fileBytes);
    }
    report.final = { storage: projection(await stored(page)), memory: await memory(page), responsiveness: await observe(page) };
    report.outcome ??= 'all-50-near-limit-originals-persisted-in-this-browser-run';
    const acceptedCount = report.final.storage.sourceCount;
    await page.reload(); await expect(page.locator('.source-open')).toHaveCount(acceptedCount);
    const reloaded = await stored(page);
    expect(reloaded.rawOriginalBytes).toBe(report.final.storage.originalBytes);
    expect(reloaded.chunks.length).toBe(report.final.storage.chunkCount);
    report.reloadPersistenceVerified = true;
    expect(external).toEqual([]); expect(errors).toEqual([]);
    report.status = 'observed';
  } catch (error) { report.status = 'failed'; report.failure = 'Harness/browser assertion failed; partial metrics do not establish capacity.'; throw error; }
  finally { report.externalRequests = external; report.pageErrors = errors; await save(`${info.project.name}-high-bytes`, report); await context.close(); }
});
