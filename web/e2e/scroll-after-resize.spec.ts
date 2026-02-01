import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  await page.locator('.terminal-container').click();
  await page.waitForTimeout(100);
}

// Helper to check if the terminal viewport is scrolled to the bottom
async function isScrolledToBottom(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.xterm-viewport');
    if (!viewport) return false;
    // Allow 5px tolerance for rounding
    return Math.abs(viewport.scrollTop + viewport.clientHeight - viewport.scrollHeight) < 5;
  });
}

test.describe('Terminal Scroll After Resize', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.xterm-rows')).toBeVisible({ timeout: 15000 });
    await focusTerminal(page);
  });

  test('should be scrolled to bottom after generating long output', async ({ page }) => {
    // Generate enough output to exceed the viewport
    await page.keyboard.type('seq 1 300');
    await page.keyboard.press('Enter');

    // Wait for output to finish
    await expect(page.locator('.xterm-rows')).toContainText('300', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Terminal should be at the bottom (scrollOnOutput: true)
    const atBottom = await isScrolledToBottom(page);
    expect(atBottom).toBe(true);
  });

  test('should stay scrolled to bottom after viewport resize', async ({ page }) => {
    // Generate long output first
    await page.keyboard.type('seq 1 300');
    await page.keyboard.press('Enter');

    // Wait for output to complete
    await expect(page.locator('.xterm-rows')).toContainText('300', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Now resize the viewport wider (simulates dragging window to full screen)
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Allow time for ResizeObserver → debouncer → fitAddon.fit() → scrollToBottom
    await page.waitForTimeout(1000);

    // Terminal should still be scrolled to the bottom
    const atBottom = await isScrolledToBottom(page);
    expect(atBottom).toBe(true);

    // The last line of output (300) should be visible
    await expect(page.locator('.xterm-rows')).toContainText('300');
  });

  test('should stay scrolled to bottom after viewport resize smaller then larger', async ({ page }) => {
    // Generate long output
    await page.keyboard.type('seq 1 300');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('300', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Resize smaller
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(1000);

    const atBottomSmall = await isScrolledToBottom(page);
    expect(atBottomSmall).toBe(true);

    // Resize back to large
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(1000);

    const atBottomLarge = await isScrolledToBottom(page);
    expect(atBottomLarge).toBe(true);
  });

  test('should scroll to bottom after browser refresh with existing output', async ({ page }) => {
    // Generate long output
    await page.keyboard.type('seq 1 300');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('300', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Refresh the page (simulates browser refresh)
    await page.reload();
    await expect(page.locator('.xterm-rows')).toBeVisible({ timeout: 15000 });

    // Wait for session history to replay and scroll
    await page.waitForTimeout(2000);

    // After refresh, terminal should show the end of the output
    const atBottom = await isScrolledToBottom(page);
    expect(atBottom).toBe(true);
  });
});
