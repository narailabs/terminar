/**
 * Visual Testing Script for Terminal Resize Rendering
 *
 * This script captures screenshots during split-pane resize operations
 * to help debug rendering issues. Screenshots are saved to .visual-tests/
 * and can be analyzed by Claude Code using the Read tool.
 *
 * Usage:
 *   pnpm visual-test           # Run with headless browser
 *   HEADED=true pnpm visual-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  resizeSteps: number;
  stepDelay: number;
  headed: boolean;
}

interface ResizeStep {
  step: number;
  deltaX: number;
  path: string;
  timestamp: string;
}

interface TestResult {
  timestamp: string;
  config: TestConfig;
  screenshots: string[];
  resizeSequence: ResizeStep[];
  rapidResizeScreenshots: string[];
  errors: string[];
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.visual-tests'),
  baseUrl: 'http://localhost:3001',
  resizeSteps: 10,
  stepDelay: 150,
  headed: process.env.HEADED === 'true',
};

async function waitForTerminalReady(page: Page, timeout = 15000): Promise<void> {
  console.log('Waiting for terminal to be ready...');
  // Try multiple selectors in case of different terminal states
  try {
    await page.waitForSelector('.xterm-rows, .terminal-container, .xterm', { timeout });
  } catch {
    console.log('Primary selectors not found, trying fallback...');
    // If terminal selectors not found, wait for workspace to load
    await page.waitForSelector('.workspace-view, .main-area, .app', { timeout: 5000 });
  }
  // Additional wait for terminal to stabilize
  await page.waitForTimeout(1000);
}

async function createSplitPane(page: Page): Promise<boolean> {
  console.log('Creating horizontal split pane...');

  // Focus on terminal container
  const terminal = page.locator('.terminal-container, .pane').first();
  await terminal.click();
  await page.waitForTimeout(200);

  // Use keyboard shortcut for horizontal split (Cmd+Shift+E)
  await page.keyboard.press('Meta+Shift+e');
  await page.waitForTimeout(500);

  // Verify split was created by looking for split handle
  const splitHandle = page.locator('.split-handle');
  const handleCount = await splitHandle.count();

  if (handleCount > 0) {
    console.log(`Split created successfully (${handleCount} handle(s) found)`);
    return true;
  }

  console.warn('Split handle not found - split may have failed');
  return false;
}

async function dragSessionToPane(page: Page, paneIndex: number = 0): Promise<boolean> {
  console.log(`Dragging session to pane ${paneIndex}...`);

  // Find a terminal session in the sidebar
  const sessionItem = page.locator('.terminal-item').first();
  const sessionBox = await sessionItem.boundingBox();

  if (!sessionBox) {
    console.log('No session found in sidebar');
    return false;
  }

  // Find the target pane
  const pane = page.locator('.pane, .empty-pane').nth(paneIndex);
  const paneBox = await pane.boundingBox();

  if (!paneBox) {
    console.log(`Pane ${paneIndex} not found`);
    return false;
  }

  // Perform drag and drop
  await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { steps: 10 });
  await page.mouse.up();

  await page.waitForTimeout(500);
  return true;
}

async function populateTerminals(page: Page): Promise<void> {
  console.log('Populating terminals with test content...');

  // First, drag sessions from sidebar into panes
  await dragSessionToPane(page, 0);

  // Try to drag second session to second pane if split exists
  const secondPane = page.locator('.pane').nth(1);
  if (await secondPane.count() > 0) {
    await dragSessionToPane(page, 1);
  }

  // Wait for terminals to attach
  await page.waitForTimeout(500);

  // Focus the first terminal and run commands
  const terminal = page.locator('.xterm-rows').first();
  if (await terminal.count() > 0) {
    await terminal.click();
    await page.waitForTimeout(200);

    // Commands that produce visible output with ANSI colors
    const commands = [
      'echo "=== TERMINAL VISUAL TEST ==="',
      'ls -la --color=always 2>/dev/null || ls -la',
      'echo -e "\\033[32mGreen\\033[0m \\033[31mRed\\033[0m \\033[34mBlue\\033[0m"',
    ];

    for (const cmd of commands) {
      await page.keyboard.type(cmd, { delay: 10 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
    }
  } else {
    console.log('No terminal found to type commands');
  }

  // Wait for output to render
  await page.waitForTimeout(500);
}

async function captureResizeSequence(
  page: Page,
  config: TestConfig,
  result: TestResult
): Promise<void> {
  console.log(`Capturing resize sequence (${config.resizeSteps} steps)...`);

  const handle = page.locator('.split-handle.horizontal').first();
  const box = await handle.boundingBox();

  if (!box) {
    result.errors.push('Split handle not found for resize sequence');
    console.error('Split handle not found');
    return;
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Capture initial state
  const initialPath = join(config.outputDir, 'resize-initial.png');
  await page.screenshot({ path: initialPath });
  result.screenshots.push(initialPath);
  console.log('  Captured initial state');

  // Resize in incremental steps (move handle left and right)
  for (let i = 0; i <= config.resizeSteps; i++) {
    // Calculate delta to sweep from left to right
    const progress = i / config.resizeSteps;
    const deltaX = (progress - 0.5) * 300; // -150px to +150px

    // Move to handle center
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Drag to new position
    await page.mouse.move(centerX + deltaX, centerY, { steps: 5 });
    await page.mouse.up();

    // Wait for render to stabilize
    await page.waitForTimeout(config.stepDelay);

    // Capture screenshot
    const filename = `resize-${i.toString().padStart(3, '0')}.png`;
    const filepath = join(config.outputDir, filename);
    await page.screenshot({ path: filepath });

    result.screenshots.push(filepath);
    result.resizeSequence.push({
      step: i,
      deltaX,
      path: filepath,
      timestamp: new Date().toISOString(),
    });

    console.log(`  Step ${i}/${config.resizeSteps}: deltaX=${deltaX.toFixed(0)}px`);
  }
}

async function captureRapidResize(
  page: Page,
  config: TestConfig,
  result: TestResult
): Promise<void> {
  console.log('Capturing rapid resize stress test...');

  const handle = page.locator('.split-handle.horizontal').first();
  const box = await handle.boundingBox();

  if (!box) {
    result.errors.push('Split handle not found for rapid resize');
    return;
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Perform 3 cycles of rapid back-and-forth resize
  for (let cycle = 0; cycle < 3; cycle++) {
    console.log(`  Rapid resize cycle ${cycle + 1}/3`);

    await page.mouse.move(centerX, centerY);
    await page.mouse.down();

    // Quick oscillation (simulates user dragging quickly)
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(centerX + 100, centerY, { steps: 2 });
      await page.mouse.move(centerX - 100, centerY, { steps: 2 });
    }

    await page.mouse.up();

    // Wait for terminal to stabilize after rapid resize
    // Need longer wait for xterm to re-render after fitAddon.fit()
    await page.waitForTimeout(500);

    const filename = `rapid-resize-${cycle}.png`;
    const filepath = join(config.outputDir, filename);
    await page.screenshot({ path: filepath });

    result.rapidResizeScreenshots.push(filepath);
  }
}

async function runVisualTest(config: TestConfig = DEFAULT_CONFIG): Promise<TestResult> {
  console.log('\n========================================');
  console.log('Terminal Visual Testing');
  console.log('========================================\n');
  console.log(`Output directory: ${config.outputDir}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Headed mode: ${config.headed}`);
  console.log('');

  // Clean and create output directory
  if (existsSync(config.outputDir)) {
    rmSync(config.outputDir, { recursive: true });
  }
  mkdirSync(config.outputDir, { recursive: true });

  const result: TestResult = {
    timestamp: new Date().toISOString(),
    config,
    screenshots: [],
    resizeSequence: [],
    rapidResizeScreenshots: [],
    errors: [],
  };

  let browser: Browser | null = null;

  try {
    // Launch browser
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.headed ? 50 : 0,
    });

    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });

    // Navigate to app
    console.log(`Navigating to ${config.baseUrl}...`);
    await page.goto(config.baseUrl, { waitUntil: 'networkidle' });

    // Capture initial page state for debugging
    const debugPath = join(config.outputDir, 'debug-initial-page.png');
    await page.screenshot({ path: debugPath });
    console.log(`Debug screenshot saved: ${debugPath}`);

    // Wait for terminal
    await waitForTerminalReady(page);

    // Create split pane layout
    const splitCreated = await createSplitPane(page);
    if (!splitCreated) {
      result.errors.push('Failed to create split pane');
    }

    // Populate terminals with content
    await populateTerminals(page);

    // Capture resize sequence
    await captureResizeSequence(page, config, result);

    // Capture rapid resize stress test
    await captureRapidResize(page, config, result);

    // Final screenshot
    const finalPath = join(config.outputDir, 'final-state.png');
    await page.screenshot({ path: finalPath, fullPage: true });
    result.screenshots.push(finalPath);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error('Test error:', errorMsg);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Write result manifest
  const manifestPath = join(config.outputDir, 'test-result.json');
  writeFileSync(manifestPath, JSON.stringify(result, null, 2));

  // Summary
  console.log('\n========================================');
  console.log('Test Complete');
  console.log('========================================');
  console.log(`Screenshots captured: ${result.screenshots.length}`);
  console.log(`Resize steps: ${result.resizeSequence.length}`);
  console.log(`Rapid resize screenshots: ${result.rapidResizeScreenshots.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`\nResults saved to: ${config.outputDir}`);
  console.log(`Manifest: ${manifestPath}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }

  console.log('\n--- Screenshot paths for Claude Code ---');
  result.screenshots.slice(0, 5).forEach(p => console.log(p));
  if (result.screenshots.length > 5) {
    console.log(`... and ${result.screenshots.length - 5} more`);
  }

  return result;
}

// CLI entry point
runVisualTest().catch(console.error);

export { runVisualTest, TestConfig, TestResult };
