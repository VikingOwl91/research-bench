import { test, expect } from '@playwright/test';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
function syntheticWav() {
  const rate = 48000, samples = rate * 3, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 1800), 44 + i * 2);
  return bytes.toString('base64');
}

test('paused native MP3 contribution seeks settle inside both speakers and preserve precise gap semantics', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const counts = { pageErrors: 0, consoleErrors: 0, csp: 0, unmockedExternal: 0 };
  page.on('pageerror', () => counts.pageErrors++);
  page.on('console', event => { if (event.type() === 'error') counts.consoleErrors++; });
  await page.exposeFunction('__timelineCSP', () => counts.csp++);
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', () => { void (window as any).__timelineCSP(); }));
  await page.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    counts.unmockedExternal++; await route.abort('blockedbyclient');
  });
  await page.route('https://api.eu.mistral.ai/v2/audio/voices**', route => route.fulfill({ headers: cors, json: { data: [{ type: 'preset', slug: 'gb_oliver_curious', id: 'fixture-oliver' }, { type: 'preset', slug: 'gb_jane_neutral', id: 'fixture-jane' }], next_page_token: null } }));
  await page.route('https://api.eu.mistral.ai/v1/chat/completions', async route => {
    const input = JSON.parse(route.request().postDataJSON().messages.at(-1).content);
    const script = { title: 'Synthetic timeline boundary regression', language: 'en', turns: ['What does the source say?', 'The source records the laboratory sample.', 'We can read the supplied source.', 'Yes, each contribution has a citation.'].map((text, index) => ({ speaker: index % 2 ? 'B' : 'A', text, citationIds: [input.sources[0].id] })) };
    await route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(script) }, finish_reason: 'stop' }] } });
  });
  const audio_data = syntheticWav();
  let speechCalls = 0;
  await page.route('https://api.eu.mistral.ai/v1/audio/speech', async route => { speechCalls++; await route.fulfill({ headers: cors, json: { audio_data } }); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  await page.locator('#source-upload').setInputFiles({ name: 'timeline-fixture.txt', mimeType: 'text/plain', buffer: Buffer.from('The laboratory source records a sample with 17 milligrams of nitrate per liter.') });
  await expect(page.locator('.source-open')).toHaveCount(1, { timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#api-key').fill('test-only-timeline-key');
  await page.locator('.key-form').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Podcast', exact: true }).click();
  await page.getByRole('button', { name: 'Create podcast', exact: true }).click();
  const audio = page.locator('.podcast-player audio');
  await expect(audio).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.podcast-turn')).toHaveCount(4);
  expect(speechCalls).toBe(4);
  const timeline = await page.evaluate(async () => new Promise<Array<{ turnId: string; start: number; end: number }>>((accept, reject) => {
    const open = indexedDB.open('researchbench-v1');
    open.onerror = () => reject(new Error('Synthetic fixture database unavailable.'));
    open.onsuccess = () => {
      const database = open.result, transaction = database.transaction('artifacts', 'readonly');
      const request = transaction.objectStore('artifacts').getAll();
      request.onsuccess = () => accept(request.result.find(item => item.kind === 'podcast' && item.status === 'ready').timeline);
      request.onerror = () => reject(new Error('Synthetic timeline unavailable.'));
      transaction.oncomplete = () => database.close();
    };
  }));
  const originalPlayer = await audio.elementHandle();
  const originalURL = await audio.getAttribute('src');
  expect(originalURL).toMatch(/^blob:/);
  await audio.evaluate((player: HTMLAudioElement) => player.play());
  await expect.poll(() => audio.evaluate((player: HTMLAudioElement) => player.currentTime)).toBeGreaterThan(0.05);
  await audio.evaluate((player: HTMLAudioElement) => player.pause());
  for (const [index, rate] of [[2, 1.2], [3, 1]] as const) {
    await page.getByRole('button', { name: `Jump to contribution ${index + 1}`, exact: true }).click();
    await expect.poll(() => audio.evaluate((player: HTMLAudioElement) => player.seeking)).toBe(false);
    const settled = await audio.evaluate((player: HTMLAudioElement) => ({ time: player.currentTime, paused: player.paused, rate: player.playbackRate }));
    expect(settled.time).toBeGreaterThan(timeline[index].start);
    expect(settled.time).toBeLessThan(timeline[index].end);
    expect(settled.time - timeline[index].start).toBeLessThan(0.001);
    expect(settled.paused).toBe(true);
    expect(settled.rate).toBe(rate);
    await expect(page.locator('.podcast-turn.playing')).toHaveCount(1);
    await expect(page.locator('.podcast-turn').nth(index)).toHaveClass(/playing/);
  }
  // A native seek into the real 180 ms pause must not highlight either turn.
  await audio.evaluate((player: HTMLAudioElement, gap) => { player.currentTime = gap; }, timeline[2].end + 0.09);
  await expect.poll(() => audio.evaluate((player: HTMLAudioElement) => player.seeking)).toBe(false);
  await expect(page.locator('.podcast-turn.playing')).toHaveCount(0);
  await page.getByRole('button', { name: 'Jump to contribution 4', exact: true }).click();
  await expect(page.locator('.podcast-turn').nth(3)).toHaveClass(/playing/);
  await page.locator('#interface-language').selectOption('de');
  expect(await audio.evaluate((player, previous) => player === previous, originalPlayer)).toBe(true);
  expect(await audio.getAttribute('src')).toBe(originalURL);
  expect(await audio.evaluate((player: HTMLAudioElement) => player.paused)).toBe(true);
  await expect(page.locator('.podcast-turn').nth(3)).toHaveClass(/playing/);
  await expect(page.locator('.podcast-content [role="alert"]')).toHaveCount(0);
  expect(counts).toEqual({ pageErrors: 0, consoleErrors: 0, csp: 0, unmockedExternal: 0 });
  await originalPlayer?.dispose();
});
