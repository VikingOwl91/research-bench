import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

// Extraction provenance in the source viewer (RB-RT-005, RB-RT-008):
// invisible/white PDF text is indexed and searchable, but marked in the viewer;
// PDFs with graphic-only pages surface an extraction-coverage notice.

const fixture = (name: string) => resolve('tests/fixtures', name);

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}
async function upload(page: import('@playwright/test').Page, name: string) {
  await page.locator('#source-upload').setInputFiles(fixture(name));
  await expect(page.locator('.source-open').filter({ hasText: name })).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#source-upload')).toBeEnabled({ timeout: 180_000 });
}

test('invisible and white PDF text is indexed, searchable and marked in the viewer', async ({ page }) => {
  await ready(page);
  await upload(page, '04-hidden-text.pdf');
  // The hidden payloads are part of the extracted, indexed text.
  await page.getByRole('button', { name: 'Local search', exact: true }).click();
  await page.locator('#question').fill('Gigawatt Produktion Park behaupten');
  await page.locator('#question').press('Enter');
  await expect(page.locator('.search-result').first()).toBeVisible({ timeout: 180_000 });
  const hit = await page.locator('.search-result').first().textContent();
  expect(hit).toContain('UNSICHTBARER_INJECTION_TEXT');
  // The viewer marks both hidden spans and explains the marking.
  await page.locator('.source-open').first().click();
  await expect(page.locator('.page-text')).toBeVisible();
  await expect(page.locator('.page-text .pdf-hidden-text')).toHaveCount(2);
  const hiddenTexts = await page.locator('.page-text .pdf-hidden-text').allTextContents();
  expect(hiddenTexts.join(' ')).toContain('UNSICHTBARER_INJECTION_TEXT');
  expect(hiddenTexts.join(' ')).toContain('WEISSER_GEHEIMER_TEXT');
  await expect(page.locator('.hidden-text-legend')).toContainText('not visible in the original PDF rendering');
  // Visible text is not marked.
  const pageText = await page.locator('.page-text').textContent();
  expect(pageText).toContain('sichtbarer Text ueber fiktive Solarmodule');
  // The extraction-coverage notice is absent for a fully text-based PDF.
  await expect(page.locator('.source-notice').filter({ hasText: 'Pages without extractable text' })).toHaveCount(0);
});

test('PDFs with graphic-only pages surface an extraction-coverage notice', async ({ page }) => {
  await ready(page);
  await upload(page, '05-mixed-pages.pdf');
  await page.locator('.source-open').first().click();
  await expect(page.locator('.page-text')).toContainText('Text auf Seite eins');
  await expect(page.locator('.source-notice').filter({ hasText: 'Pages without extractable text: 1 of 2' })).toBeVisible();
  // Navigating to the textless page keeps the notice and shows the empty-page state.
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('.source-notice').filter({ hasText: 'Pages without extractable text: 1 of 2' })).toBeVisible();
  // No hidden-text legend on a PDF without hidden spans.
  await expect(page.locator('.hidden-text-legend')).toHaveCount(0);
});
