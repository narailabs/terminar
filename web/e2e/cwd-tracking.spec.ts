import { test, expect, Page } from '@playwright/test';

// Helper to focus the terminal before typing
async function focusTerminal(page: Page) {
  await page.locator('.terminal-container').first().click();
  await page.waitForTimeout(100);
}

// On macOS, /tmp resolves to /private/tmp via symlink
function isTmpPath(path: string | null): boolean {
  return path === '/tmp' || path === '/private/tmp';
}

test('sidebar updates CWD when user changes directory', async ({ page }) => {
  await page.goto('/');

  // Wait for terminal to connect and appear
  await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.terminal-item').first()).toBeVisible({ timeout: 10000 });

  const cwdElements = page.locator('.terminal-item .cwd');

  // Record baseline /tmp count (sessions may accumulate across test runs)
  async function countTmpCwds(): Promise<number> {
    const count = await cwdElements.count();
    let tmpCount = 0;
    for (let i = 0; i < count; i++) {
      const title = await cwdElements.nth(i).getAttribute('title');
      if (isTmpPath(title)) tmpCount++;
    }
    return tmpCount;
  }
  const baselineTmpCount = await countTmpCwds();

  // Focus terminal pane and cd to /tmp
  await focusTerminal(page);
  await page.keyboard.type('cd /tmp');
  await page.keyboard.press('Enter');

  // Wait for /tmp count to increase (polling interval ~1s)
  await expect(async () => {
    const current = await countTmpCwds();
    expect(current).toBeGreaterThan(baselineTmpCount);
  }).toPass({ timeout: 15000 });

  // cd back to home to verify it updates again
  await focusTerminal(page);
  await page.waitForTimeout(500);
  await page.keyboard.type('cd ~');
  await page.keyboard.press('Enter');

  // /tmp count should return to the baseline
  await expect(async () => {
    const current = await countTmpCwds();
    expect(current).toBe(baselineTmpCount);
  }).toPass({ timeout: 15000 });
});

test('multiple terminals show independent CWDs', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.xterm-rows').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.terminal-item').first()).toBeVisible({ timeout: 10000 });

  const initialCount = await page.locator('.terminal-item').count();

  // Create a fresh terminal, select it, and cd to /tmp
  await page.locator('.new-terminal-btn').click();
  await expect(page.locator('.terminal-item')).toHaveCount(initialCount + 1, { timeout: 5000 });
  await page.locator('.terminal-item').last().click();
  await page.waitForTimeout(500);

  await focusTerminal(page);
  await page.keyboard.type('cd /tmp');
  await page.keyboard.press('Enter');

  // Wait for at least one session to show /tmp CWD
  await expect(async () => {
    const cwdElements = page.locator('.terminal-item .cwd');
    const count = await cwdElements.count();
    let foundTmp = false;
    for (let i = 0; i < count; i++) {
      const title = await cwdElements.nth(i).getAttribute('title');
      if (isTmpPath(title)) foundTmp = true;
    }
    expect(foundTmp).toBeTruthy();
  }).toPass({ timeout: 15000 });

  // Create another terminal
  const countBefore = await page.locator('.terminal-item').count();
  await page.locator('.new-terminal-btn').click();
  await expect(page.locator('.terminal-item')).toHaveCount(countBefore + 1, { timeout: 5000 });

  // After creating the second terminal, we should have both /tmp and non-/tmp CWDs
  // (the new session starts in $HOME, the old one is in /tmp)
  await expect(async () => {
    const cwdElements = page.locator('.terminal-item .cwd');
    const count = await cwdElements.count();
    let hasTmp = false;
    let hasNonTmp = false;
    for (let i = 0; i < count; i++) {
      const title = await cwdElements.nth(i).getAttribute('title');
      if (isTmpPath(title)) hasTmp = true;
      else if (title) hasNonTmp = true;
    }
    expect(hasTmp).toBeTruthy();
    expect(hasNonTmp).toBeTruthy();
  }).toPass({ timeout: 15000 });
});
