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
    return Math.abs(viewport.scrollTop + viewport.clientHeight - viewport.scrollHeight) < 5;
  });
}

// Scroll viewport up and trigger the wheel event handler atomically.
// page.mouse.wheel() fires a real wheel event but xterm/flushWriteBuffer
// can override scrollTop before we can observe it.  Instead, set scrollTop
// directly and dispatch a WheelEvent so the autoScroll flag updates.
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

// Scroll viewport to the very bottom and trigger wheel-down handler.
async function scrollDownToBottom(page: Page) {
  await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement;
    if (!vp) return;
    vp.scrollTop = vp.scrollHeight - vp.clientHeight;
    vp.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
  });
  await page.waitForTimeout(100);
}

test.describe('Terminal Auto-Scroll During Active Output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.xterm-rows')).toBeVisible({ timeout: 15000 });
    await focusTerminal(page);

    // Clean up any leftover stop file from previous runs
    await page.keyboard.type('rm -f /tmp/terminar-stop-e2e');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  });

  test.afterEach(async ({ page }) => {
    await focusTerminal(page);
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(500);
    await page.keyboard.type('rm -f /tmp/terminar-stop-e2e');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  });

  test('should auto-scroll to bottom during continuous output', async ({ page }) => {
    await page.keyboard.type('i=0; while [ ! -f /tmp/terminar-stop-e2e ]; do i=$((i+1)); echo "LINE $i"; sleep 0.05; done');
    await page.keyboard.press('Enter');

    // Wait for output to accumulate
    await page.waitForTimeout(2000);

    const atBottom = await isScrolledToBottom(page);
    expect(atBottom).toBe(true);

    await page.keyboard.press('Control+c');
  });

  test('scroll-up should pause auto-scroll during continuous output', async ({ page }) => {
    await page.keyboard.type('i=0; while [ ! -f /tmp/terminar-stop-e2e ]; do i=$((i+1)); echo "LINE $i"; sleep 0.05; done');
    await page.keyboard.press('Enter');

    // Wait for enough output to create scrollback
    await page.waitForTimeout(2000);

    // Scroll up — sets autoScroll=false immediately
    await scrollUpInTerminal(page);

    // Should no longer be at the bottom
    const atBottomAfterScroll = await isScrolledToBottom(page);
    expect(atBottomAfterScroll).toBe(false);

    // Wait for more output to arrive
    await page.waitForTimeout(1500);

    // The viewport should NOT have snapped back to the bottom
    const atBottomAfterOutput = await isScrolledToBottom(page);
    expect(atBottomAfterOutput).toBe(false);

    await page.keyboard.press('Control+c');
  });

  test('scroll-down-to-bottom should resume auto-scroll', async ({ page }) => {
    await page.keyboard.type('i=0; while [ ! -f /tmp/terminar-stop-e2e ]; do i=$((i+1)); echo "LINE $i"; sleep 0.05; done');
    await page.keyboard.press('Enter');

    // Wait for output
    await page.waitForTimeout(2000);

    // Scroll up to disable auto-scroll
    await scrollUpInTerminal(page);

    const notAtBottom = await isScrolledToBottom(page);
    expect(notAtBottom).toBe(false);

    // Scroll back down to the very bottom
    await scrollDownToBottom(page);

    // Wait for more output
    await page.waitForTimeout(1500);

    // Auto-scroll should have resumed — viewport should be at bottom
    const atBottomAfterResume = await isScrolledToBottom(page);
    expect(atBottomAfterResume).toBe(true);

    await page.keyboard.press('Control+c');
  });
});
