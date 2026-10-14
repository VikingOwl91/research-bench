import { test, expect, type Page } from '@playwright/test';

async function fitsWindow(page: Page) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    shellWidth: document.querySelector('.app-shell')!.getBoundingClientRect().width,
    footerBottom: document.querySelector('.app-footer')!.getBoundingClientRect().bottom
  }));
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.width);
  expect(metrics.scrollHeight, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.height);
  expect(metrics.shellWidth).toBe(metrics.width);
  // Firefox DOMRect arithmetic can differ by <0.0001px; document bounds above remain exact.
  expect(metrics.footerBottom).toBeCloseTo(metrics.height, 3);
}

test('desktop fills the window across wide and compact viewports in both languages', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  for (const language of ['en', 'de']) {
    await page.locator('#interface-language').selectOption(language);
    for (const fontSize of ['100%', '200%']) {
      await page.evaluate(size => document.documentElement.style.fontSize = size, fontSize);
      for (const [width, height] of [[1280, 480], [1280, 720], [1920, 1080], [2560, 1440], [3440, 1440]]) {
        await page.setViewportSize({ width, height });
        await fitsWindow(page);
        // Focus must reveal controls through internal scroll containers even at 200% text.
        for (const selector of ['#question', '.provider-bar', '.generator-tabs button:last-child', '.source-open', '.repo-link']) {
          const control = page.locator(selector).first();
          if (!await control.count() || !await control.isEnabled()) continue;
          await control.focus();
          await expect(control).toBeFocused();
          await expect(control).toBeInViewport();
          await fitsWindow(page);
        }
      }
    }
  }
});

test('narrow screens retain document scrolling and every selected pane', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeEnabled();
  for (const width of [320, 375, 430, 768]) {
    await page.setViewportSize({ width, height: 568 });
    for (const name of ['Sources', 'Research', 'Studio']) {
      await page.locator('.mobile-navigation').getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(568);
      await page.getByRole('link', { name: 'GitHub', exact: true }).focus();
      await expect(page.getByRole('link', { name: 'GitHub', exact: true })).toBeInViewport();
    }
  }
});
