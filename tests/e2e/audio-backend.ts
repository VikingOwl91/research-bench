import { expect, type Page } from '@playwright/test';

/** Check initialized, advancing audio rather than Firefox's initial suspended state. */
export async function probeAudioBackend(page: Page, timeoutMs = 5_000): Promise<{ running: boolean; advanced: boolean }> {
  return page.evaluate(async timeout => {
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      const start = context.currentTime;
      // Resume may remain pending without an audio device or autoplay permission.
      // Poll within the deadline rather than awaiting that promise indefinitely.
      void context.resume().catch(() => {});
      const deadline = performance.now() + timeout;
      while (performance.now() < deadline) {
        if (context.state === 'running' && context.currentTime > start + 0.02) return { running: true, advanced: true };
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return { running: context.state === 'running', advanced: context.currentTime > start + 0.02 };
    } catch {
      return { running: false, advanced: false };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }, timeoutMs);
}

/** Playback is required coverage. Missing output is an actionable failure, never a silent skip. */
export async function requireAudioBackend(page: Page): Promise<void> {
  expect(await probeAudioBackend(page), 'Native playback requires an initialized audio output with an advancing clock; CI supplies a PulseAudio null sink.').toEqual({ running: true, advanced: true });
}
