import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/ms-playwright');
export default defineConfig({
  testDir: './tests/performance',
  testMatch: process.env.CAPACITY_HIGH_BYTES === '1' ? 'high-bytes.spec.ts' : 'capacity.spec.ts',
  timeout: 1_800_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  maxFailures: 1,
  reporter: [['list']],
  outputDir: '.cache/phase-a/playwright',
  use: {
    baseURL: 'http://127.0.0.1:4183', viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off',
    actionTimeout: 30_000, navigationTimeout: 45_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'node scripts/serve-build.mjs build 4183',
    url: 'http://127.0.0.1:4183', reuseExistingServer: false, timeout: 30_000,
  },
});
