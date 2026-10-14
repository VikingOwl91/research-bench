import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AxeResults } from 'axe-core';

const axeSource = readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8');
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
}
async function appearance(page: Page, value: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Appearance', { exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'Close settings' }).click();
}
async function scan(page: Page, state: string) {
  // Automation evaluates axe in this owned test context; no script is shipped to users.
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => (window as any).axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] }
  })) as AxeResults;
  await test.info().attach(`axe-${state}`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), state).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal page overflow').toBe(true);
}

test('saved preference applies before delayed app bootstrap; System follows OS without reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('researchbench:theme', 'dark'));
  let holding = true;
  const held: (() => Promise<void>)[] = [];
  await page.route('**/_app/immutable/**/*.js', route => { if (holding) held.push(() => route.continue()); else void route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  holding = false;
  await Promise.all(held.map(resume => resume()));
  await page.unroute('**/_app/immutable/**/*.js');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  await appearance(page, 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  const marker = await page.evaluate(() => { (window as any).appearanceIdentity = 'kept'; return location.href; });
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await appearance(page, 'light');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  expect(await page.evaluate(() => (window as any).appearanceIdentity)).toBe('kept');
  expect(page.url()).toBe(marker);
});

test('appearance persists, synchronizes tabs, tolerates invalid and unavailable storage', async ({ page, context }) => {
  await ready(page);
  await appearance(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const other = await context.newPage(); await ready(other);
  await appearance(other, 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await other.evaluate(() => localStorage.setItem('researchbench:theme', 'unknown'));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await other.close();
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key === 'researchbench:theme') throw new DOMException('blocked', 'SecurityError'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key === 'researchbench:theme') throw new DOMException('blocked', 'SecurityError'); return set.call(this, key, value); };
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await appearance(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('EN/DE light and dark controls and dialogs remain accessible at all six widths', async ({ page }) => {
  await ready(page);
  for (const theme of ['light', 'dark']) {
    await appearance(page, theme);
    for (const width of [320, 375, 430, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: width <= 430 ? 844 : 1000 });
      await noOverflow(page);
      await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
      if (width <= 1100) await page.locator('.mobile-navigation').getByRole('button', { name: 'Research', exact: true }).click();
      await expect(page.locator('.composer-footnote')).toBeVisible();
      await scan(page, `${theme}-${width}-chat`);
      await page.screenshot({ path: `.cache/ui-v004/after/${test.info().project.name}-${theme}-${width}-chat.png`, fullPage: true });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Connection & privacy' })).toBeVisible();
      await scan(page, `${theme}-${width}-settings`);
      await page.screenshot({ path: `.cache/ui-v004/after/${test.info().project.name}-${theme}-${width}-settings.png`, fullPage: true });
      await page.getByRole('button', { name: 'Close settings' }).click();
      if (width <= 1100) await page.locator('.mobile-navigation').getByRole('button', { name: 'Studio', exact: true }).click();
      for (const tab of ['Overview', 'FAQ', 'Learn', 'Podcast']) {
        await page.locator('.generator-tabs').getByRole('button', { name: tab, exact: true }).click();
        await expect(page.locator('.source-reference-note')).toBeVisible();
        await noOverflow(page);
      }
      await scan(page, `${theme}-${width}-podcast`);
      await page.screenshot({ path: `.cache/ui-v004/after/${test.info().project.name}-${theme}-${width}-podcast.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('#interface-language').selectOption('de');
    await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
    await expect(page.getByLabel('Darstellung', { exact: true })).toHaveValue(theme);
    await scan(page, `${theme}-de-settings`);
    await noOverflow(page);
    await page.getByRole('button', { name: 'Einstellungen schließen' }).click();
    await page.locator('#interface-language').selectOption('en');
  }
});

test('keyboard-only settings, native select, nested confirmation, skip and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#workspace')).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Connection & privacy' });
  await expect(dialog.getByRole('button', { name: 'Close settings' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Appearance', { exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  for (let i = 0; i < 16; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true); }
  await dialog.getByRole('button', { name: 'Delete', exact: true }).focus(); await page.keyboard.press('Enter');
  const confirmation = page.locator('.confirmation-dialog');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 640, height: 500 }); // reflow equivalent to 1280px at 200% browser zoom
  await noOverflow(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await page.locator('dialog[open]').evaluate(node => node.getBoundingClientRect().height <= innerHeight)).toBe(true);
  const bounds = await page.locator('.settings-dialog').boundingBox();
  await page.mouse.click(bounds!.x + 4, bounds!.y + 4);
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).not.toBeVisible();
  await page.locator('.mobile-navigation').getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Create notebook', exact: true }).click();
  await expect(page.locator('#notebook-name')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#notebook-name')).toHaveCount(0);
});

test('saved Light precedes app rendering even with a dark OS preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('researchbench:theme', 'light'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/_app/immutable/**/*.js', async route => { await gate; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  release();
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
});

test('200% text resizing keeps header controls separate and forms within the viewport', async ({ page }) => {
  await ready(page);
  // CSS-root text scaling stresses rem-based controls separately from the zoom/reflow check.
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  for (const width of [320, 375, 430, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    expect(await page.evaluate(() => {
      const brand = document.querySelector('.brand')!.getBoundingClientRect();
      const actions = document.querySelector('.header-actions')!.getBoundingClientRect();
      return brand.right <= actions.left || brand.bottom <= actions.top || actions.bottom <= brand.top;
    }), `overlapping header at ${width}px with 200% text`).toBe(true);
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await noOverflow(page);
    expect(await page.locator('.settings-dialog').evaluate(node => node.getBoundingClientRect().height <= innerHeight)).toBe(true);
    await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.screenshot({ path: `.cache/ui-v004/after/${test.info().project.name}-text200-${width}.png`, fullPage: true });
  }
});
