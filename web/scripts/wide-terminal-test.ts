/**
 * Wide Terminal Test - Tests TUI rendering at various terminal widths
 *
 * This script tests for rendering issues when the terminal is wide:
 * 1. Starts at a normal width
 * 2. Progressively widens the terminal
 * 3. Tests TUI rendering (Claude Code /config) at each width
 * 4. Captures screenshots to detect corruption
 *
 * Usage:
 *   pnpm wide-test              # Run with headless browser
 *   HEADED=true pnpm wide-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  headed: boolean;
  widths: number[]; // Browser widths to test
  claudeCodeCommand: string;
}

interface WidthTestResult {
  width: number;
  cols: number;
  rows: number;
  screenshot: string;
  renderTime: number;
  issues: string[];
}

interface TestResult {
  timestamp: string;
  config: TestConfig;
  widthTests: WidthTestResult[];
  screenshots: string[];
  errors: string[];
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.wide-tests'),
  baseUrl: 'http://localhost:3001',
  headed: process.env.HEADED === 'true',
  // Test progressively wider terminals
  widths: [800, 1024, 1280, 1600, 1920, 2560],
  claudeCodeCommand: 'claude',
};

async function waitForTerminalReady(page: Page, timeout = 15000): Promise<void> {
  console.log('Waiting for terminal to be ready...');
  try {
    await page.waitForSelector('.xterm-rows, .terminal-container, .xterm', { timeout });
  } catch {
    console.log('Primary selectors not found, trying fallback...');
    await page.waitForSelector('.workspace-view, .main-area, .app', { timeout: 5000 });
  }
  await page.waitForTimeout(1000);
}

async function dragSessionToPane(page: Page): Promise<boolean> {
  const sessionItems = page.locator('.terminal-item');
  const count = await sessionItems.count();

  if (count === 0) return false;

  // Find zsh session
  for (let i = 0; i < count; i++) {
    const item = sessionItems.nth(i);
    const text = await item.textContent();
    if (text && text.toLowerCase().includes('zsh')) {
      const sessionBox = await item.boundingBox();
      if (!sessionBox) continue;

      const pane = page.locator('.pane, .empty-pane').first();
      const paneBox = await pane.boundingBox();
      if (!paneBox) continue;

      await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(1000);
      return true;
    }
  }
  return false;
}

async function focusTerminal(page: Page): Promise<boolean> {
  const terminal = page.locator('.xterm-rows').first();
  if (await terminal.count() > 0) {
    await terminal.click();
    await page.waitForTimeout(200);
    return true;
  }

  const dragged = await dragSessionToPane(page);
  if (!dragged) return false;

  const terminalAfterDrag = page.locator('.xterm-rows').first();
  if (await terminalAfterDrag.count() > 0) {
    await terminalAfterDrag.click();
    await page.waitForTimeout(200);
    return true;
  }
  return false;
}

async function getTerminalDimensions(page: Page): Promise<{ cols: number; rows: number }> {
  // Try to get dimensions from xterm instance
  const dims = await page.evaluate(() => {
    // @ts-ignore - accessing xterm from window
    const term = (window as any).__xterm_instance__;
    if (term) {
      return { cols: term.cols, rows: term.rows };
    }
    // Fallback: estimate from DOM
    const rows = document.querySelector('.xterm-rows');
    if (rows) {
      const rowElements = rows.querySelectorAll('.xterm-rows > div');
      const firstRow = rowElements[0];
      if (firstRow) {
        // Rough estimate based on character width
        const charWidth = 8; // approximate
        const cols = Math.floor(rows.clientWidth / charWidth);
        return { cols, rows: rowElements.length };
      }
    }
    return { cols: 80, rows: 24 };
  });
  return dims;
}

async function handleTrustPrompt(page: Page): Promise<void> {
  const content = await page.locator('.xterm-rows').first().textContent({ timeout: 1000 }).catch(() => '');
  if (content && (content.includes('Do you trust') || content.includes('trust the files'))) {
    await page.keyboard.type('1', { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }
}

async function waitForClaudeCodeReady(page: Page, timeout = 30000): Promise<boolean> {
  const startTime = Date.now();
  const readyIndicators = ['Claude Code', 'Welcome', '❯', '/help'];

  await handleTrustPrompt(page);

  while (Date.now() - startTime < timeout) {
    const content = await page.locator('.xterm-rows').first().textContent({ timeout: 1000 }).catch(() => '');
    if (content) {
      if (content.includes('Do you trust')) {
        await handleTrustPrompt(page);
        continue;
      }
      for (const indicator of readyIndicators) {
        if (content.includes(indicator)) {
          await page.waitForTimeout(500);
          return true;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function startClaudeCode(page: Page, config: TestConfig): Promise<boolean> {
  // Exit any existing session
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(500);

  // Start Claude Code
  await page.keyboard.type(config.claudeCodeCommand, { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  return await waitForClaudeCodeReady(page);
}

async function openConfigMenu(page: Page): Promise<void> {
  await page.keyboard.type('/config', { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
}

async function exitConfigMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

async function testWidthRendering(
  page: Page,
  width: number,
  config: TestConfig,
): Promise<WidthTestResult> {
  const issues: string[] = [];

  console.log(`\nTesting width: ${width}px`);

  // Resize viewport
  const startResize = Date.now();
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(500); // Wait for resize debounce

  // Get terminal dimensions
  const dims = await getTerminalDimensions(page);
  console.log(`  Terminal: ${dims.cols}x${dims.rows}`);

  // Check for very wide terminals
  if (dims.cols > 200) {
    issues.push(`Very wide terminal: ${dims.cols} columns`);
  }

  // Open config menu to test TUI rendering
  await openConfigMenu(page);
  await page.waitForTimeout(300);

  // Capture screenshot
  const screenshotPath = join(config.outputDir, `width-${width}.png`);
  await page.screenshot({ path: screenshotPath });

  // Cycle through tabs to test rendering
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
  }

  // Capture after tab cycling
  const afterTabsPath = join(config.outputDir, `width-${width}-tabs.png`);
  await page.screenshot({ path: afterTabsPath });

  // Check for visual issues by analyzing screenshot
  // (In a real implementation, you'd use image comparison)
  const renderTime = Date.now() - startResize;

  if (renderTime > 2000) {
    issues.push(`Slow render: ${renderTime}ms`);
  }

  // Exit config menu
  await exitConfigMenu(page);

  // Test rapid resize (simulates user dragging)
  // Using 150ms intervals to simulate realistic human dragging speed
  console.log('  Testing rapid resize...');
  const rapidResizeStart = Date.now();
  for (let w = width; w > width - 200 && w > 600; w -= 50) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(150);
  }
  // Return to original width
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(500);

  const rapidResizeTime = Date.now() - rapidResizeStart;
  if (rapidResizeTime > 3000) {
    issues.push(`Slow rapid resize: ${rapidResizeTime}ms`);
  }

  // Capture after rapid resize
  const afterResizePath = join(config.outputDir, `width-${width}-after-resize.png`);
  await page.screenshot({ path: afterResizePath });

  // Open config again to check for corruption after resize
  await openConfigMenu(page);
  await page.waitForTimeout(300);
  const afterResizeConfigPath = join(config.outputDir, `width-${width}-config-after-resize.png`);
  await page.screenshot({ path: afterResizeConfigPath });
  await exitConfigMenu(page);

  return {
    width,
    cols: dims.cols,
    rows: dims.rows,
    screenshot: screenshotPath,
    renderTime,
    issues,
  };
}

async function runWideTerminalTest(config: TestConfig = DEFAULT_CONFIG): Promise<TestResult> {
  console.log('\n========================================');
  console.log('Wide Terminal Test');
  console.log('========================================\n');
  console.log(`Output directory: ${config.outputDir}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Widths to test: ${config.widths.join(', ')}px`);
  console.log('');

  // Clean and create output directory
  if (existsSync(config.outputDir)) {
    rmSync(config.outputDir, { recursive: true });
  }
  mkdirSync(config.outputDir, { recursive: true });

  const result: TestResult = {
    timestamp: new Date().toISOString(),
    config,
    widthTests: [],
    screenshots: [],
    errors: [],
  };

  let browser: Browser | null = null;

  try {
    console.log('Launching browser...');
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.headed ? 50 : 0,
    });

    // Start with minimum width
    const page = await browser.newPage({
      viewport: { width: config.widths[0], height: 800 },
    });

    console.log(`Navigating to ${config.baseUrl}...`);
    await page.goto(config.baseUrl, { waitUntil: 'networkidle' });

    await waitForTerminalReady(page);

    const focused = await focusTerminal(page);
    if (!focused) {
      result.errors.push('Could not focus terminal');
      return result;
    }

    // Start Claude Code
    console.log('Starting Claude Code...');
    const started = await startClaudeCode(page, config);
    if (!started) {
      result.errors.push('Claude Code did not start');

      const failedPath = join(config.outputDir, 'claude-failed.png');
      await page.screenshot({ path: failedPath });
      result.screenshots.push(failedPath);
      return result;
    }

    // Test each width
    for (const width of config.widths) {
      try {
        const widthResult = await testWidthRendering(page, width, config);
        result.widthTests.push(widthResult);
        result.screenshots.push(widthResult.screenshot);

        if (widthResult.issues.length > 0) {
          console.log(`  Issues: ${widthResult.issues.join(', ')}`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Width ${width}: ${errorMsg}`);
        console.error(`  Error at width ${width}: ${errorMsg}`);
      }
    }

    // Final screenshot
    const finalPath = join(config.outputDir, 'final-state.png');
    await page.screenshot({ path: finalPath });
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
  console.log(`Widths tested: ${result.widthTests.length}`);
  console.log(`Screenshots captured: ${result.screenshots.length}`);
  console.log(`Errors: ${result.errors.length}`);

  // Report issues per width
  console.log('\nResults by width:');
  for (const wt of result.widthTests) {
    const status = wt.issues.length === 0 ? '✓' : '✗';
    console.log(`  ${status} ${wt.width}px (${wt.cols}x${wt.rows}) - ${wt.renderTime}ms`);
    for (const issue of wt.issues) {
      console.log(`      - ${issue}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }

  console.log(`\nResults saved to: ${config.outputDir}`);

  return result;
}

// CLI entry point
runWideTerminalTest().catch(console.error);

export { runWideTerminalTest, TestConfig, TestResult };
