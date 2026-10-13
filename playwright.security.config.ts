import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/ms-playwright');
export default defineConfig({
  testDir: './tests/security', timeout: 300_000, expect: { timeout: 30_000 },
  workers: 1, retries: 0, fullyParallel: false, reporter: [['list']],
  outputDir: '.cache/security-tests',
  use: { trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block', ignoreHTTPSErrors: false, viewport: { width: 1440, height: 1000 } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
});
