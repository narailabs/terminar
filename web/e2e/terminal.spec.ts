import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  // Click on the terminal container to focus it
  await page.locator('.terminal-container').first().click();
  // Wait a bit for focus to take effect
  await page.waitForTimeout(100);
}

test('terminal connects and shows prompt', async ({ page }) => {
  page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));

  // Go to the app - local connections auto-connect without auth
  await page.goto('/');

  // Wait for terminal to appear (local connection auto-connects)
  const terminal = page.locator('.xterm-rows').first();
  await expect(terminal).toBeVisible({ timeout: 15000 });

  // Focus the terminal before typing
  await focusTerminal(page);

  // Send input to trigger a prompt
  await page.keyboard.type('echo "hello world"');
  await page.keyboard.press('Enter');

  // Check for output
  await expect(page.locator('.xterm-rows').first()).toContainText('hello world', { timeout: 10000 });
});

test('terminal receives shell output', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });

  await focusTerminal(page);

  // Run a command that produces output
  await page.keyboard.type('pwd');
  await page.keyboard.press('Enter');

  // Should show a path (starting with /)
  await expect(page.locator('.xterm-rows').first()).toContainText('/', { timeout: 5000 });
});

test('terminal handles special characters', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });

  await focusTerminal(page);

  // Test special characters
  await page.keyboard.type('echo "special: @#$%"');
  await page.keyboard.press('Enter');

  await expect(page.locator('.xterm-rows').first()).toContainText('special: @#$%', { timeout: 5000 });
});
