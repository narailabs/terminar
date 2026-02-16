import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  await page.locator('.terminal-container').first().click();
  await page.waitForTimeout(100);
}

test.describe('Terminal Persistence', () => {
  test('retains session output after reload', async ({ page }) => {
    // 1. Connect (local auto-connects without auth)
    await page.goto('/');

    // Wait for terminal
    const terminal = page.locator('.xterm-rows').first();
    await expect(terminal).toBeVisible({ timeout: 15000 });

    // 2. Run a unique command
    await focusTerminal(page);
    const uniqueMarker = `PERSIST_CHECK_${Date.now()}`;
    await page.keyboard.type(`echo "${uniqueMarker}"`);
    await page.keyboard.press('Enter');

    // Wait for output
    await expect(terminal).toContainText(uniqueMarker, { timeout: 5000 });

    // 3. Reload the page
    await page.reload();

    // 4. Wait for reconnection (local auto-connects)
    await expect(terminal).toBeVisible({ timeout: 15000 });

    // 5. Verify old output is still there (session persisted on server)
    // Allow more time for history replay after reconnection
    await expect(terminal).toContainText(uniqueMarker, { timeout: 10000 });
  });

  test('retains multiple sessions after reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });

    // Get initial count
    const initialCount = await page.locator('.terminal-item').count();

    // Create a second session using button
    await page.locator('.new-terminal-btn').click();
    await expect(page.locator('.terminal-item')).toHaveCount(initialCount + 1);

    // Reload
    await page.reload();
    await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });

    // Wait for sidebar to populate with session list from server
    await expect(page.locator('.terminal-item').first()).toBeVisible({ timeout: 10000 });

    // Sessions should still exist (at least the number we had)
    const afterCount = await page.locator('.terminal-item').count();
    expect(afterCount).toBeGreaterThanOrEqual(initialCount + 1);
  });
});
