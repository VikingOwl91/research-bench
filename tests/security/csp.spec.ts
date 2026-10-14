import { test, expect } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveBuild } from '../../scripts/serve-build.mjs';
import { headersForPath, DOCUMENT_HEADER_CSP, validateDocumentPolicy, validateSecurityHeaders } from '../../scripts/hosting-policy.mjs';

test('delivered header and early meta jointly enforce scripts, WASM, workers and blob media', async ({ page }) => {
  const instance = await serveBuild({ port: 0, extraFiles: new Map([['/security-probes.js', resolve('tests/security/csp-probes.js')]]) });
  try {
    await page.addInitScript(() => {
      (window as any).__securityViolations = [];
      document.addEventListener('securitypolicyviolation', event => (window as any).__securityViolations.push(event.effectiveDirective));
    });
    const response = await page.goto(instance.origin);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    validateSecurityHeaders(response!.headers(), 'index.html', { https: false });
    validateDocumentPolicy(await response!.text(), response!.headers()['content-security-policy']);
    expect(await page.evaluate(() => (window as any).__securityViolations)).toEqual([]);
    const workers = await readdir('build/_app/immutable/workers');
    const workerPath = '/_app/immutable/workers/' + workers.find(name => name.startsWith('pipeline.worker-'));
    const workerResponse = await fetch(instance.origin + workerPath);
    validateSecurityHeaders(workerResponse.headers, workerPath, { https: false });
    await workerResponse.body?.cancel();
    const workerEvent = page.waitForEvent('worker');
    await page.evaluate(path => { (window as any).__allowedWorker = new Worker(path, { type: 'module' }); }, workerPath);
    const worker = await workerEvent;
    expect(await worker.evaluate(async () => (await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))) instanceof WebAssembly.Module)).toBe(true);
    await page.evaluate(() => { const script = document.createElement('script'); script.type = 'module'; script.src = '/security-probes.js'; document.head.append(script); });
    await page.locator('#security-probe').click();
    await expect.poll(() => page.evaluate(() => (window as any).__probeResults)).toBeTruthy();
    const blocked = await page.evaluate(() => (window as any).__probeResults);
    expect(blocked).toEqual({ inline: true, eval: true, wasm: true, blobWorker: true });
    expect((await page.evaluate(() => (window as any).__securityViolations)).length).toBeGreaterThanOrEqual(3);
    await page.evaluate(() => (window as any).__allowedWorker.terminate());
  } finally { await instance.close(); }
});

test('header restriction overrides the valid bootstrap meta and survives server recovery in an open document', async ({ browser }) => {
  let broken = true;
  const instance = await serveBuild({ port: 0, headers: path => ({ ...headersForPath(path), 'Content-Security-Policy': DOCUMENT_HEADER_CSP + (broken ? "; script-src 'none'" : '') }) });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(instance.origin);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('meta[http-equiv="content-security-policy"]').length)).toBe(1);
    broken = false;
    // Fetching new bytes does not replace the CSP installed in this document.
    const fetched = await page.evaluate(async () => (await fetch('/')).headers.get('content-security-policy'));
    expect(fetched).not.toContain("script-src 'none'");
    const retained = await page.evaluate(() => {
      const script = document.createElement('script'); script.src = document.querySelector('link[rel="modulepreload"]')!.getAttribute('href')!;
      return new Promise<boolean>(resolve => { script.onload = () => resolve(false); script.onerror = () => resolve(true); document.body.append(script); });
    });
    expect(retained).toBe(true);
    await page.goto(instance.origin);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    const freshContext = await browser.newContext();
    try {
      const fresh = await freshContext.newPage(); const response = await fresh.goto(instance.origin);
      validateSecurityHeaders(response!.headers(), 'index.html', { https: false });
      validateDocumentPolicy(await response!.text(), response!.headers()['content-security-policy']);
      await expect(fresh.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    } finally { await freshContext.close(); }
  } finally { await context.close(); await instance.close(); }
});

test('actual response blocks same-origin framing, and tampered or late meta fails artifact acceptance', async ({ browser }) => {
  const instance = await serveBuild({ port: 0, extraFiles: new Map([['/frame-fixture.html', resolve('tests/security/frame-fixture.html')]]), headers: path => path === 'frame-fixture.html' ? {} : headersForPath(path) });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(instance.origin);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
    // The parent prohibits frames independently; use an unprotected fixture
    // response to prove the target's HTTP frame-ancestors/XFO decision.
    await page.goto(instance.origin + '/frame-fixture.html');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('iframe')).toHaveCount(1);
    expect(await page.evaluate(() => {
      const iframe = document.querySelector('iframe')!;
      try { return iframe.contentDocument?.querySelectorAll('.settings-trigger').length ?? 0; }
      catch { return 0; } // Browser error documents may have an opaque origin.
    })).toBe(0);
    const html = await readFile('build/index.html', 'utf8');
    expect(() => validateDocumentPolicy(html.replace('http-equiv="content-security-policy"', 'http-equiv="unused"'), DOCUMENT_HEADER_CSP)).toThrow();
    expect(() => validateDocumentPolicy(html.replace('<meta http-equiv', '<link rel="preload" href="/early.js"><meta http-equiv'), DOCUMENT_HEADER_CSP)).toThrow();
    // The early theme initializer is external; tamper the actual inline bootstrap.
    const bootstrapStart = /(<script\b(?![^>]*\bsrc\s*=)[^>]*>)/;
    expect(html).toMatch(bootstrapStart);
    expect(() => validateDocumentPolicy(html.replace(bootstrapStart, '$1window.changedBootstrap=true;'), DOCUMENT_HEADER_CSP)).toThrow();
  } finally { await context.close(); await instance.close(); }
});
