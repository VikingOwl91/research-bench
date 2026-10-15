import { test, expect } from '@playwright/test';
import { probeAudioBackend, requireAudioBackend } from './audio-backend';

test('native audio becomes ready and advances in both required browsers', async ({ page }) => {
  await requireAudioBackend(page);
});

test('audio readiness waits for delayed initialization and closes its context', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).closedAudioProbe = false;
    (window as any).AudioContext = class {
      state = 'suspended'; started = 0;
      get currentTime() { return this.started ? (performance.now() - this.started) / 1000 : 0; }
      async resume() { await new Promise(resolve => setTimeout(resolve, 75)); this.state = 'running'; this.started = performance.now(); }
      async close() { this.state = 'closed'; (window as any).closedAudioProbe = true; }
    };
  });
  expect(await probeAudioBackend(page, 1_000)).toEqual({ running: true, advanced: true });
  expect(await page.evaluate(() => (window as any).closedAudioProbe)).toBe(true);
});

test('unavailable audio is bounded, closed, and reported without skipping coverage', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).closedAudioProbe = false;
    (window as any).AudioContext = class {
      state = 'suspended'; currentTime = 0;
      resume() { return new Promise<void>(() => {}); }
      async close() { this.state = 'closed'; (window as any).closedAudioProbe = true; }
    };
  });
  expect(await probeAudioBackend(page, 100)).toEqual({ running: false, advanced: false });
  expect(await page.evaluate(() => (window as any).closedAudioProbe)).toBe(true);
});
