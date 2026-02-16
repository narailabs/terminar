import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  await page.locator('.terminal-container').first().click();
  await page.waitForTimeout(100);
}

test.describe('Search (Cmd/Ctrl+F)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.workspace-area')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });
    await focusTerminal(page);
  });

  test('Cmd/Ctrl+F opens the search bar', async ({ page }) => {
    // Verify search bar is not visible initially
    await expect(page.locator('.search-bar')).not.toBeVisible();

    // Press Cmd+F (macOS) or Ctrl+F (Linux/Windows)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+f`);

    // Search bar should appear with a focused input
    await expect(page.locator('.search-bar')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.search-bar input')).toBeFocused();
  });

  test('Escape closes the search bar', async ({ page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+f`);
    await expect(page.locator('.search-bar')).toBeVisible({ timeout: 3000 });

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-bar')).not.toBeVisible({ timeout: 3000 });
  });

  test('search finds text in terminal output', async ({ page }) => {
    // Create a fresh terminal to avoid restored sessions with TUI apps
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+Shift+n`);
    await page.waitForTimeout(1000);
    await focusTerminal(page);

    // Generate some unique output to search for
    const marker = `SEARCH_TEST_${Date.now()}`;
    await page.keyboard.type(`echo "${marker}"`);
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows').first()).toContainText(marker, { timeout: 5000 });

    // Open search and type the marker
    await page.keyboard.press(`${modifier}+f`);
    await expect(page.locator('.search-bar')).toBeVisible({ timeout: 3000 });

    await page.locator('.search-bar input').fill(marker);
    // Wait for search results to update (debounced)
    await page.waitForTimeout(500);

    // Should show at least 1 match (the echo command + output)
    const matchInfo = page.locator('.search-bar .match-info');
    await expect(matchInfo).toBeVisible({ timeout: 3000 });
    await expect(matchInfo).not.toHaveText('0/0');
  });
});
