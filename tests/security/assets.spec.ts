import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('an already prepared pinned asset set needs no downloads', () => {
  // Exercise the real preparer: an accidental fetch fails instead of using network.
  const denyFetch = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("Unexpected asset download")};';
  const output = execFileSync(process.execPath, ['--import', denyFetch, 'scripts/prepare-assets.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
  });
  expect(output).toContain('Verified 27 self-hosted files');
});
