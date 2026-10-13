import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const question = "How does the NIST announcement describe the purpose of the AI RMF, and how does the framework's Core turn that purpose into practical risk management activities? Explain the four functions and how they work together.";
const followup = 'Using only the two uploaded documents, what specific tasks and actions are explicitly documented for MAP, MEASURE, and MANAGE? Distinguish statements directly supported by the source text or Figure 5 from interpretations. If the excerpts do not provide detailed tasks for a function, say so explicitly. Cite the relevant source for each supported statement.';
const endpoint = /https:\/\/(api\.eu\.mistral\.ai|openrouter\.ai)\/.*chat\/completions/;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };

async function exported(page: Page, index: number, label = 'Export source context') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).nth(index).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('researchbench-source-context.json');
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

test('saved NIST source export matches the actual request, including unused passages, reload and stale sources; it is not an entailment check', async ({ page }) => {
  const requestSources: Array<Array<{ id: string; page: number; text: string }>> = [];
  const unexpected: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:4173/') || url.startsWith('blob:')) return route.continue();
    if (!endpoint.test(url)) { unexpected.push(url); return route.abort(); }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // Retain only the selected source projection: no headers, question/history or full request log.
    const sources = JSON.parse(route.request().postDataJSON().messages.at(-1).content).sources;
    requestSources.push(sources);
    // Deliberately unsupported wording with a valid ID reproduces the known semantic gap.
    // This test certifies source-snapshot export, not a grounding correction.
    const answer = { title: 'Diagnostic fixture', blocks: [{ heading: 'MAP', text: 'MAP explicitly documents stakeholder mapping and risk metrics.', citationIds: [sources[0].id] }] };
    return route.fulfill({ headers: cors, json: { choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] } });
  });
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    (window as any).contextDownloadUrls = { created: [], revoked: [] };
    URL.createObjectURL = object => { const url = create(object); if (object instanceof Blob && object.type === 'application/json') (window as any).contextDownloadUrls.created.push(url); return url; };
    URL.revokeObjectURL = url => { (window as any).contextDownloadUrls.revoked.push(url); revoke(url); };
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  await page.locator('#source-upload').setInputFiles(['nist-ai-rmf-core-excerpt.pdf', 'nist-ai-rmf-launch.txt'].map(name => resolve('docs/public-demo', name)));
  await expect(page.locator('.source-open')).toHaveCount(2, { timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#api-key').fill('test-only-context-export-key');
  await page.locator('.key-form').getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  for (const [index, text] of [question, followup].entries()) {
    await page.locator('#question').fill(text); await page.locator('#question').press('Enter');
    await expect(page.locator('.chat-message:not(.user-message)')).toHaveCount(index + 1);
    await expect(page.getByRole('button', { name: 'Export source context', exact: true })).toHaveCount(index + 1);
  }
  expect(requestSources).toHaveLength(2);
  expect(requestSources.every(sources => sources.length === 6)).toBe(true);
  for (let index = 0; index < 2; index++) {
    const data = await exported(page, index);
    expect(data).toEqual({ sources: requestSources[index] });
    expect(Object.keys(data)).toEqual(['sources']);
    expect(data.sources.every((source: object) => Object.keys(source).sort().join() === 'id,page,text')).toBe(true);
    expect(JSON.stringify(data)).not.toContain('test-only-context-export-key');
    // Five selected passages were unused by this fixture answer but still belong in the snapshot.
    await expect(page.locator('.chat-message:not(.user-message)').nth(index).locator('.citation')).toHaveCount(1);
  }
  await expect(page.locator('.user-message .source-context-export')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => {
    const { created, revoked } = (window as any).contextDownloadUrls;
    return created.every((url: string) => revoked.includes(url));
  })).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export source context', exact: true })).toHaveCount(2);
  expect(await exported(page, 0)).toEqual({ sources: requestSources[0] });
  // Revision changes must not replace the completed answer's frozen context with current retrieval.
  await page.locator('.source-row').filter({ hasText: 'nist-ai-rmf-launch.txt' }).locator('.source-remove').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(page.locator('.source-open')).toHaveCount(1);
  expect(await exported(page, 0)).toEqual({ sources: requestSources[0] });
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('de');
  expect(await exported(page, 1, 'Quellenkontext exportieren')).toEqual({ sources: requestSources[1] });
  await expect.poll(async () => page.evaluate(() => {
    const { created, revoked } = (window as any).contextDownloadUrls;
    return created.every((url: string) => revoked.includes(url));
  })).toBe(true);
  expect(requestSources).toHaveLength(2); // Downloads/reload/source changes add no provider calls.
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});
