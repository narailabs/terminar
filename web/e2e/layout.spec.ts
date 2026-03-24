import { test, expect } from '@playwright/test';

test.describe('Terminal Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.terminal-container').first()).toBeVisible({ timeout: 15000 });
  });

  test('terminal area fills available space', async ({ page }) => {
    const terminalArea = page.locator('.workspace-area');
    const box = await terminalArea.boundingBox();
    expect(box).toBeTruthy();
    // Terminal area should be substantial
    expect(box!.width).toBeGreaterThan(400);
    expect(box!.height).toBeGreaterThan(300);
  });

  test('resizes with viewport', async ({ page }) => {
    // Initial size
    const initialBox = await page.locator('.workspace-area').boundingBox();
    expect(initialBox).toBeTruthy();

    // Resize viewport smaller
    await page.setViewportSize({ width: 800, height: 600 });

    // Allow time for resize observer
    await page.waitForTimeout(500);

    const newBox = await page.locator('.workspace-area').boundingBox();
    expect(newBox).toBeTruthy();

    // Should have resized down (accounting for sidebar)
    expect(newBox!.width).toBeLessThan(initialBox!.width);

    // Resize larger
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(500);

    const largerBox = await page.locator('.workspace-area').boundingBox();
    expect(largerBox!.width).toBeGreaterThan(newBox!.width);
  });

  test('sidebar layout is correct', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).toBeTruthy();

    // Sidebar should be on the right
    const mainArea = page.locator('.main-area');
    const mainBox = await mainArea.boundingBox();
    expect(mainBox).toBeTruthy();

    // Sidebar x should be greater than main area x + width
    expect(sidebarBox!.x).toBeGreaterThanOrEqual(mainBox!.x + mainBox!.width - 10);
  });

  test('sidebar toggle changes layout', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleBtn = page.locator('.toggle-btn');

    // Initial width (open)
    const openBox = await sidebar.boundingBox();
    expect(openBox!.width).toBeGreaterThan(100); // Should be ~250px

    // Toggle closed using button (not keyboard shortcut)
    await toggleBtn.click();
    await page.waitForTimeout(200);

    const closedBox = await sidebar.boundingBox();
    expect(closedBox!.width).toBeLessThan(50); // Should be ~24px

    // Terminal area should expand
    const terminalArea = page.locator('.workspace-area');
    const expandedTerminal = await terminalArea.boundingBox();
    expect(expandedTerminal!.width).toBeGreaterThan(openBox!.x - 50);
  });
});
