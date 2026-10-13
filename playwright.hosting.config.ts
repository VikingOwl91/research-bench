import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('.cache/ms-playwright');
if (!process.env.RESEARCHBENCH_HOSTING_URL) throw new Error('Set RESEARCHBENCH_HOSTING_URL to the explicit HTTPS origin to verify.');
const target = new URL(process.env.RESEARCHBENCH_HOSTING_URL);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname);
if (target.username || target.password || target.pathname !== '/' || target.search || target.hash || (target.protocol !== 'https:' && !(loopback && target.protocol === 'http:'))) {
  throw new Error('Hosting target must be an HTTPS origin or an explicitly selected HTTP loopback origin.');
}

export default defineConfig({
  testDir: './tests/hosting',
  timeout: 300_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '.cache/hosting-tests',
  use: {
    baseURL: target.origin,
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    serviceWorkers: 'block',
    ignoreHTTPSErrors: false,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  // A real deployment or an explicitly started loopback server is required.
  // Never start a local server implicitly when checking a public origin.
});
