import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  await page.locator('.terminal-container').first().click();
  await page.waitForTimeout(100);
}

// Helper to check if the terminal viewport is scrolled to the bottom
async function isScrolledToBottom(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.xterm-viewport');
    if (!viewport) return false;
    return Math.abs(viewport.scrollTop + viewport.clientHeight - viewport.scrollHeight) < 5;
  });
}

// Scroll viewport up by setting scrollTop to 0 and dispatching a wheel event.
// This triggers the autoScroll = false logic in Terminal.svelte.
async function scrollUpInTerminal(page: Page) {
  await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement;
    if (!vp) return;
    vp.scrollTop = 0;
    vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
  });
  // Allow rAF in the wheel handler to run and confirm not-at-bottom
  await page.waitForTimeout(100);
}

// Generate enough terminal output to create scrollback.
// Writes numbered lines then stops, so output is static for reliable assertions.
async function generateScrollback(page: Page) {
  await page.keyboard.type('for i in $(seq 1 200); do echo "LINE $i"; done');
  await page.keyboard.press('Enter');
  // Wait for all output to render
  await page.waitForTimeout(2000);
}

test.describe('Scroll-to-Bottom Badge', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });
    await focusTerminal(page);
  });

  test('badge appears when user scrolls up in a terminal with content', async ({ page }) => {
    // Generate enough output to create scrollback
    await generateScrollback(page);

    // Verify we start at the bottom with no badge visible
    const atBottom = await isScrolledToBottom(page);
    expect(atBottom).toBe(true);
    await expect(page.locator('.scroll-to-bottom-badge')).not.toBeVisible();

    // Take a screenshot before scrolling (no badge)
    await page.screenshot({ path: 'test-results/scroll-badge-before-scroll.png' });

    // Scroll up to trigger the badge
    await scrollUpInTerminal(page);

    // The badge should now be visible
    await expect(page.locator('.scroll-to-bottom-badge')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.scroll-to-bottom-badge')).toHaveText('Scroll to bottom');

    // Take a screenshot showing the badge
    await page.screenshot({ path: 'test-results/scroll-badge-visible.png' });
  });

  test('clicking the badge scrolls to bottom and hides the badge', async ({ page }) => {
    // Generate scrollback and scroll up to show the badge
    await generateScrollback(page);
    await scrollUpInTerminal(page);

    // Verify badge is visible
    await expect(page.locator('.scroll-to-bottom-badge')).toBeVisible({ timeout: 2000 });

    // Take a screenshot with badge visible before clicking
    await page.screenshot({ path: 'test-results/scroll-badge-before-click.png' });

    // Click the badge
    await page.locator('.scroll-to-bottom-badge').click();

    // Wait for scroll animation and Svelte reactivity
    await page.waitForTimeout(300);

    // Badge should be hidden
    await expect(page.locator('.scroll-to-bottom-badge')).not.toBeVisible();

    // Viewport should be at the bottom
    const atBottom = await isScrolledToBottom(page);
    expect(atBottom).toBe(true);

    // Take a screenshot after clicking (badge gone, scrolled to bottom)
    await page.screenshot({ path: 'test-results/scroll-badge-after-click.png' });
  });

  test('badge does not appear when terminal has no scrollback', async ({ page }) => {
    // Just a short command that won't create scrollback
    await page.keyboard.type('echo hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Even after a wheel-up event, if there's no scrollback the viewport stays at bottom
    // and autoScroll should re-enable via the rAF isAtBottom() check
    await page.evaluate(() => {
      const vp = document.querySelector('.xterm-viewport') as HTMLElement;
      if (!vp) return;
      vp.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    });
    await page.waitForTimeout(200);

    // Badge should not be visible (viewport is still at bottom)
    await expect(page.locator('.scroll-to-bottom-badge')).not.toBeVisible();
  });

  test('badge reappears after scrolling up again', async ({ page }) => {
    // Generate scrollback
    await generateScrollback(page);

    // Scroll up -> badge appears
    await scrollUpInTerminal(page);
    await expect(page.locator('.scroll-to-bottom-badge')).toBeVisible({ timeout: 2000 });

    // Click badge -> scrolls down, badge disappears
    await page.locator('.scroll-to-bottom-badge').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.scroll-to-bottom-badge')).not.toBeVisible();

    // Scroll up again -> badge should reappear
    await scrollUpInTerminal(page);
    await expect(page.locator('.scroll-to-bottom-badge')).toBeVisible({ timeout: 2000 });

    // Take a screenshot of the reappeared badge
    await page.screenshot({ path: 'test-results/scroll-badge-reappeared.png' });
  });
});
