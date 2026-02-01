/**
 * Visual Testing for Terminal Resize Rendering
 *
 * This test captures screenshots during split-pane resize operations
 * to help debug rendering issues. Run with:
 *   pnpm test:e2e:visual
 *
 * Screenshots are saved to .visual-tests/ and can be analyzed
 * by Claude Code using the Read tool.
 */

import { test, expect } from '@playwright/test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const OUTPUT_DIR = join(process.cwd(), '.visual-tests');

interface TestManifest {
  timestamp: string;
  testName: string;
  screenshots: string[];
  steps: { name: string; path: string; timestamp: string }[];
}

test.describe('Visual Rendering Tests', () => {
  let manifest: TestManifest;

  test.beforeAll(() => {
    // Clean and create output directory
    if (existsSync(OUTPUT_DIR)) {
      rmSync(OUTPUT_DIR, { recursive: true });
    }
    mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    manifest = {
      timestamp: new Date().toISOString(),
      testName: '',
      screenshots: [],
      steps: [],
    };

    await page.goto('/');
    await expect(page.locator('.xterm-rows')).toBeVisible({ timeout: 15000 });
    // Wait for terminal to fully initialize
    await page.waitForTimeout(500);
  });

  test.afterEach(() => {
    // Save manifest for this test
    if (manifest.screenshots.length > 0) {
      const manifestPath = join(OUTPUT_DIR, `${manifest.testName || 'test'}-manifest.json`);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  });

  test('capture split pane resize sequence', async ({ page }) => {
    manifest.testName = 'split-resize';

    // Helper to capture screenshot
    const capture = async (name: string) => {
      const filename = `${manifest.testName}-${name}.png`;
      const filepath = join(OUTPUT_DIR, filename);
      await page.screenshot({ path: filepath });
      manifest.screenshots.push(filepath);
      manifest.steps.push({
        name,
        path: filepath,
        timestamp: new Date().toISOString(),
      });
    };

    // Step 1: Initial state
    await capture('01-initial');

    // Step 2: Focus terminal and create horizontal split
    const terminal = page.locator('.terminal-container, .pane').first();
    await terminal.click();
    await page.waitForTimeout(200);

    // Create horizontal split (Cmd+Shift+E)
    await page.keyboard.press('Meta+Shift+e');
    await page.waitForTimeout(500);
    await capture('02-after-split');

    // Step 3: Populate terminals with content
    const commands = [
      'echo "=== VISUAL TEST ==="',
      'ls -la --color=always 2>/dev/null || ls -la',
      'echo -e "\\033[32mGreen\\033[0m \\033[31mRed\\033[0m \\033[34mBlue\\033[0m"',
    ];

    for (const cmd of commands) {
      await page.keyboard.type(cmd, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(300);
    await capture('03-with-content');

    // Step 4: Find split handle and perform resize sequence
    const splitHandle = page.locator('.split-handle.horizontal').first();
    const handleBox = await splitHandle.boundingBox();

    if (!handleBox) {
      // If no horizontal split handle, the split may not have been created
      console.log('No split handle found - skipping resize tests');
      return;
    }

    const centerX = handleBox.x + handleBox.width / 2;
    const centerY = handleBox.y + handleBox.height / 2;

    // Resize sequence: move handle left, then right
    const resizeSteps = [
      { name: '04-resize-left-50', deltaX: -50 },
      { name: '05-resize-left-100', deltaX: -100 },
      { name: '06-resize-center', deltaX: 0 },
      { name: '07-resize-right-50', deltaX: 50 },
      { name: '08-resize-right-100', deltaX: 100 },
      { name: '09-resize-right-150', deltaX: 150 },
      { name: '10-resize-center-final', deltaX: 0 },
    ];

    for (const step of resizeSteps) {
      // Perform drag
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + step.deltaX, centerY, { steps: 5 });
      await page.mouse.up();

      // Wait for render to stabilize
      await page.waitForTimeout(150);

      // Capture screenshot
      await capture(step.name);
    }

    // Step 5: Rapid resize stress test
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Quick back-and-forth
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(centerX + 80, centerY, { steps: 2 });
      await page.mouse.move(centerX - 80, centerY, { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(200);
    await capture('11-after-rapid-resize');

    console.log(`\nVisual test complete. Screenshots saved to: ${OUTPUT_DIR}`);
    console.log(`Total screenshots: ${manifest.screenshots.length}`);
  });

  test('capture vertical split resize', async ({ page }) => {
    manifest.testName = 'vertical-split';

    const capture = async (name: string) => {
      const filename = `${manifest.testName}-${name}.png`;
      const filepath = join(OUTPUT_DIR, filename);
      await page.screenshot({ path: filepath });
      manifest.screenshots.push(filepath);
      manifest.steps.push({
        name,
        path: filepath,
        timestamp: new Date().toISOString(),
      });
    };

    await capture('01-initial');

    // Create vertical split (Cmd+Shift+O)
    const terminal = page.locator('.terminal-container, .pane').first();
    await terminal.click();
    await page.keyboard.press('Meta+Shift+o');
    await page.waitForTimeout(500);
    await capture('02-after-vertical-split');

    // Add content
    await page.keyboard.type('echo "Vertical split test"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await capture('03-with-content');

    // Find vertical split handle
    const splitHandle = page.locator('.split-handle.vertical').first();
    const handleBox = await splitHandle.boundingBox();

    if (!handleBox) {
      console.log('No vertical split handle found');
      return;
    }

    const centerX = handleBox.x + handleBox.width / 2;
    const centerY = handleBox.y + handleBox.height / 2;

    // Resize vertically
    const resizeSteps = [
      { name: '04-resize-up', deltaY: -50 },
      { name: '05-resize-down', deltaY: 50 },
      { name: '06-resize-center', deltaY: 0 },
    ];

    for (const step of resizeSteps) {
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX, centerY + step.deltaY, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      await capture(step.name);
    }
  });

  test('capture TUI app resize (if Claude Code available)', async ({ page }) => {
    manifest.testName = 'tui-resize';

    const capture = async (name: string) => {
      const filename = `${manifest.testName}-${name}.png`;
      const filepath = join(OUTPUT_DIR, filename);
      await page.screenshot({ path: filepath });
      manifest.screenshots.push(filepath);
      manifest.steps.push({
        name,
        path: filepath,
        timestamp: new Date().toISOString(),
      });
    };

    await capture('01-initial');

    // Try to run a simple TUI app (top or htop)
    await page.keyboard.type('top -l 1 2>/dev/null || echo "top not available"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await capture('02-tui-output');

    // Create split
    await page.keyboard.press('Meta+Shift+e');
    await page.waitForTimeout(500);
    await capture('03-split-with-tui');

    // Resize with TUI content
    const splitHandle = page.locator('.split-handle.horizontal').first();
    const handleBox = await splitHandle.boundingBox();

    if (handleBox) {
      const centerX = handleBox.x + handleBox.width / 2;
      const centerY = handleBox.y + handleBox.height / 2;

      // Quick resize
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX - 100, centerY, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      await capture('04-after-resize-tui');
    }
  });
});
