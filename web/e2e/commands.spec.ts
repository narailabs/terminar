import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  await page.locator('.terminal-container').first().click();
  await page.waitForTimeout(100);
}

test.describe('Shell Commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to connect and render workspace before checking for terminal
    await expect(page.locator('.workspace-area')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });
    await focusTerminal(page);
  });

  test('can run pwd', async ({ page }) => {
    // Use a unique marker to distinguish this test's output from session history
    const marker = `PWD_TEST_${Date.now()}`;
    await page.keyboard.type(`echo "${marker}" && pwd`);
    await page.keyboard.press('Enter');
    // Expect both the marker and a path (contains /)
    await expect(page.locator('.xterm-rows').first()).toContainText(marker, { timeout: 5000 });
    await expect(page.locator('.xterm-rows').first()).toContainText('/Users', { timeout: 5000 });
  });

  test('can run ls', async ({ page }) => {
    await page.keyboard.type('ls -la');
    await page.keyboard.press('Enter');
    // Expect total or some file permission chars like drwx
    await expect(page.locator('.xterm-rows').first()).toContainText(/total|drwx/, { timeout: 5000 });
  });

  test('can handle multiline output', async ({ page }) => {
    await page.keyboard.type('seq 1 5');
    await page.keyboard.press('Enter');
    const terminal = page.locator('.xterm-rows').first();
    await expect(terminal).toContainText('1', { timeout: 5000 });
    await expect(terminal).toContainText('2');
    await expect(terminal).toContainText('3');
    await expect(terminal).toContainText('4');
    await expect(terminal).toContainText('5');
  });

  test('can run command with arguments', async ({ page }) => {
    await page.keyboard.type('echo "test argument"');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows').first()).toContainText('test argument', { timeout: 5000 });
  });

  test('can handle environment variables', async ({ page }) => {
    await page.keyboard.type('echo $HOME');
    await page.keyboard.press('Enter');
    // HOME should contain a path
    await expect(page.locator('.xterm-rows').first()).toContainText('/Users', { timeout: 5000 });
  });
});
