import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { documentDirectives, verifyAnnouncerSource, validateDocumentPolicy, DOCUMENT_HEADER_CSP } from './scripts/hosting-policy.mjs';
import { modelBasePath } from './scripts/model-assets.mjs';

verifyAnnouncerSource();
const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const gitSHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(gitSHA)) throw new Error('Build requires a full Git commit identity.');
const staticAdapter = adapter({ fallback: 'index.html' });
const secureAdapter: typeof staticAdapter = {
  ...staticAdapter,
  async adapt(builder) {
    await staticAdapter.adapt(builder);
    validateDocumentPolicy(readFileSync(new URL('./build/index.html', import.meta.url), 'utf8'), DOCUMENT_HEADER_CSP);
  }
};
const assetManifest = JSON.parse(readFileSync(new URL('./scripts/assets-manifest.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: { __SOURCE_COMMIT__: JSON.stringify(gitSHA), __MODEL_ASSET_BASE__: JSON.stringify(modelBasePath(assetManifest)) },
  plugins: [sveltekit({
    adapter: secureAdapter,
    version: { name: `${packageVersion}+${gitSHA}` },
    csp: { mode: 'hash', directives: documentDirectives as NonNullable<NonNullable<Parameters<typeof sveltekit>[0]>['csp']>['directives'] }
  })],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
});
