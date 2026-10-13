import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { validateDocumentPolicy, validateSecurityHeaders, validateWorkerPolicy } from '../../scripts/hosting-policy.mjs';

const probePrefix = '/__hosting_security__/';
function observe(page: Page) {
  const counts = { unexpectedEgress: 0, pageErrors: 0, unexpectedConsoleErrors: 0, nativeSecurityMessages: 0, blockedFrames: 0 };
  page.on('pageerror', () => counts.pageErrors++);
  page.on('console', event => {
    if (event.type() !== 'error' && event.type() !== 'warning') return;
    if (/frame-ancestors|X-Frame-Options|Framing .*violates/i.test(event.text())) counts.blockedFrames++;
    if (/X-Frame-Options|Content[- ]Security[- ]Policy|content security policy|unsafe-eval|wasm-unsafe-eval|Refused to|violates.*policy/i.test(event.text())) counts.nativeSecurityMessages++;
    else if (event.type() === 'error') counts.unexpectedConsoleErrors++;
  });
  return counts;
}
async function guard(page: Page, origin: string, counts: ReturnType<typeof observe>, additionalOrigin?: string) {
  await page.route('**/*', async route => {
    const address = new URL(route.request().url());
    if (address.origin === origin || address.origin === additionalOrigin || address.protocol === 'blob:' || address.protocol === 'data:') return route.continue();
    counts.unexpectedEgress++;
    await route.abort('blockedbyclient');
  });
}
async function deliveredDocument(page: Page, origin: string) {
  await page.addInitScript(() => {
    (window as any).__hostingViolations = {};
    document.addEventListener('securitypolicyviolation', event => {
      const classification = `${event.effectiveDirective}:${event.blockedURI === 'inline' ? 'inline' : event.blockedURI === 'eval' ? 'eval' : event.blockedURI === 'wasm-eval' ? 'wasm-eval' : event.blockedURI === 'blob' || event.blockedURI.startsWith('blob:') ? 'blob' : 'other'}`;
      const counts = (window as any).__hostingViolations;
      counts[classification] = (counts[classification] ?? 0) + 1;
    });
  });
  const response = await page.goto(origin);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  validateSecurityHeaders(response!.headers(), 'index.html', { https: origin.startsWith('https:'), origin });
  validateDocumentPolicy(await response!.text(), response!.headers()['content-security-policy'], { origin });
  expect(await page.evaluate(() => (window as any).__hostingViolations)).toEqual({});
}
async function installModule(page: Page, origin: string, body: string) {
  const path = probePrefix + 'actions.js';
  await page.route(origin + path, route => route.fulfill({ contentType: 'text/javascript', body }));
  await page.evaluate(path => { const script = document.createElement('script'); script.type = 'module'; script.src = path; document.head.append(script); }, path);
}
async function workerHeaders(page: Page, origin: string) {
  // Discover the worker entry from the scripts actually loaded by this release,
  // rather than assuming that a local build has the deployed filenames.
  const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => new URL(url).pathname.endsWith('.js')));
  expect(scripts.length).toBeLessThan(64);
  let filename: string | undefined;
  for (const url of scripts) {
    if (new URL(url).origin !== origin) continue;
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    expect(response.status).toBe(200);
    filename = (await response.text()).match(/pipeline\.worker-[A-Za-z0-9_-]+\.js/)?.[0];
    if (filename) break;
  }
  expect(filename, 'Worker entry is discoverable in the loaded application').toBeTruthy();
  const path = '/_app/immutable/workers/' + filename;
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30_000) });
  expect(response.status).toBe(200);
  validateSecurityHeaders(response.headers, path, { https: origin.startsWith('https:'), origin });
  validateWorkerPolicy(response.headers.get('content-security-policy'), { origin });
  const policy = response.headers.get('content-security-policy')!;
  await response.body?.cancel();
  return policy;
}
function assertQuiet(counts: ReturnType<typeof observe>, intentionalSecurity = false) {
  expect(counts.unexpectedEgress).toBe(0);
  expect(counts.pageErrors).toBe(0);
  expect(counts.unexpectedConsoleErrors).toBe(0);
  if (!intentionalSecurity) expect(counts.nativeSecurityMessages).toBe(0);
}

test('delivered document and worker policies enforce their own realms and allow ordinary worker WASM', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const counts = observe(page); await guard(page, origin, counts);
  await deliveredDocument(page, origin);
  const policy = await workerHeaders(page, origin);
  const workerPath = probePrefix + 'worker.js';
  await page.route(origin + workerPath, route => route.fulfill({ headers: { 'content-security-policy': policy, 'content-type': 'text/javascript' }, body: `self.onmessage = async () => { try { const result = await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])); self.postMessage(result instanceof WebAssembly.Module); } catch { self.postMessage(false); } };` }));
  await installModule(page, origin, `const button = document.createElement('button'); button.id = 'hosting-worker-probe'; button.textContent = 'Worker proof'; button.addEventListener('click', () => { const worker = new Worker('${workerPath}', { type: 'module' }); worker.onmessage = event => { window.__workerProof = event.data; worker.terminate(); }; worker.postMessage(1); }); document.body.append(button);`);
  await page.locator('#hosting-worker-probe').click();
  await expect.poll(() => page.evaluate(() => (window as any).__workerProof)).toBe(true);
  expect(await page.evaluate(() => (window as any).__hostingViolations)).toEqual({});
  assertQuiet(counts);
});

test('ordinary same-origin module clicks prove document inline, evaluation, WASM and blob-worker denial', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const counts = observe(page); await guard(page, origin, counts);
  await deliveredDocument(page, origin); assertQuiet(counts);
  await installModule(page, origin, await readFile(new URL('../security/csp-probes.js', import.meta.url), 'utf8'));
  await page.locator('#security-probe').click();
  await expect.poll(() => page.evaluate(() => (window as any).__probeResults)).toEqual({ inline: true, eval: true, wasm: true, blobWorker: true });
  await expect.poll(() => page.evaluate(() => (window as any).__hostingViolations)).toEqual({
    'script-src-elem:inline': 1, 'script-src:eval': 1, 'script-src:wasm-eval': 1, 'worker-src:blob': 2
  });
  assertQuiet(counts, true);
});

test('actual target response cannot be framed by an unprotected owned parent', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    response.end(`<html><body><iframe title="Controlled frame" src="${origin}/"></iframe></body></html>`);
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned parent origin.');
  const parent = `http://127.0.0.1:${address.port}`;
  const counts = observe(page); await guard(page, origin, counts, parent);
  try {
    await deliveredDocument(page, origin); assertQuiet(counts);
    await page.goto(parent);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('iframe')).toHaveCount(1);
    // Native framing denial proves that the actual target response was rejected;
    // cross-origin DOM inaccessibility alone would also occur for an allowed frame.
    await expect.poll(() => counts.blockedFrames).toBeGreaterThan(0);
    assertQuiet(counts, true);
  } finally {
    await new Promise<void>((accept, reject) => { server.close(error => error ? reject(error) : accept()); server.closeIdleConnections(); });
  }
});

test('the delivered policy permits locally created blob audio without violations or egress', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const counts = observe(page); await guard(page, origin, counts);
  await deliveredDocument(page, origin);
  await installModule(page, origin, `
    const button = document.createElement('button'); button.id='hosting-media-probe'; button.textContent='Audio proof';
    button.addEventListener('click', () => {
      const data = new ArrayBuffer(44 + 8000 * 2), bytes = new DataView(data);
      const text = (offset, value) => [...value].forEach((char,index) => bytes.setUint8(offset+index,char.charCodeAt(0)));
      text(0,'RIFF'); bytes.setUint32(4,data.byteLength-8,true); text(8,'WAVEfmt '); bytes.setUint32(16,16,true); bytes.setUint16(20,1,true); bytes.setUint16(22,1,true); bytes.setUint32(24,8000,true); bytes.setUint32(28,16000,true); bytes.setUint16(32,2,true); bytes.setUint16(34,16,true); text(36,'data'); bytes.setUint32(40,16000,true);
      const url=URL.createObjectURL(new Blob([data],{type:'audio/wav'})); const audio=document.createElement('audio'); audio.preload='auto'; audio.onloadedmetadata=()=>{window.__blobAudioProof=audio.duration; URL.revokeObjectURL(url);}; audio.onerror=()=>{window.__blobAudioProof=-1; URL.revokeObjectURL(url);}; audio.src=url; document.body.append(audio);
    }); document.body.append(button);
  `);
  await page.locator('#hosting-media-probe').click();
  await expect.poll(() => page.evaluate(() => (window as any).__blobAudioProof)).toBe(1);
  expect(await page.evaluate(() => (window as any).__hostingViolations)).toEqual({});
  assertQuiet(counts);
});
