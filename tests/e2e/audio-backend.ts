import { test, type Page } from '@playwright/test';

/**
 * CI provisions an isolated audio null sink (pulseaudio) for native playback
 * tests. Environments without a running audio backend cannot advance media
 * playback (AudioContext stays suspended), so tests that assert playback
 * progress skip there with a documented reason instead of failing on
 * environment capability. In CI the backend is present and they run.
 */
export async function requireAudioBackend(page: Page): Promise<void> {
  const state = await page.evaluate(async () => {
    try {
      const context = new AudioContext();
      const state = context.state;
      await context.close();
      return state;
    } catch {
      return 'unavailable';
    }
  });
  test.skip(state !== 'running', `No running audio backend (AudioContext state: ${state}); CI provides a pulseaudio null sink for native playback tests.`);
}
