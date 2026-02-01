/**
 * Config Arrow Key Test - Tests Claude Code /config navigation at wide widths
 *
 * This script specifically tests arrow key navigation in the config menu
 * to identify rendering corruption issues.
 *
 * Usage:
 *   pnpm config-test              # Run with headless browser
 *   HEADED=true pnpm config-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  headed: boolean;
  testWidth: number;
  testHeight: number;
  noWebGL: boolean;
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.config-arrow-tests'),
  baseUrl: 'http://localhost:3001',
  headed: process.env.HEADED === 'true',
  testWidth: 2000, // Wide terminal
  testHeight: 800,
  noWebGL: process.env.NO_WEBGL === 'true',
};

async function waitForTerminalReady(page: Page, timeout = 15000): Promise<void> {
  console.log('Waiting for terminal to be ready...');
  try {
    await page.waitForSelector('.xterm-rows, .terminal-container, .xterm', { timeout });
  } catch {
    console.log('Primary selectors not found, trying fallback...');
    await page.waitForSelector('.workspace-view, .main-area, .app', { timeout: 5000 });
  }
  await page.waitForTimeout(1500);
}

async function dragSessionToPane(page: Page): Promise<boolean> {
  const sessionItems = page.locator('.terminal-item');
  const count = await sessionItems.count();

  if (count === 0) return false;

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

async function startClaudeCode(page: Page): Promise<boolean> {
  // Exit any existing session
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(500);

  // Start Claude Code
  await page.keyboard.type('claude', { delay: 50 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);

  return await waitForClaudeCodeReady(page);
}

async function getTerminalInfo(page: Page): Promise<{ cols: number; rows: number; containerWidth: number; xtermWidth: number; cellWidth: number }> {
  return await page.evaluate(() => {
    const xtermCore = document.querySelector('.xterm') as any;
    let cols = 80, rows = 24, cellWidth = 0;

    if (xtermCore && xtermCore._core) {
      cols = xtermCore._core._bufferService?.cols || cols;
      rows = xtermCore._core._bufferService?.rows || rows;
      cellWidth = xtermCore._core?._renderService?.dimensions?.css?.cell?.width || 0;
    }

    const container = document.querySelector('.terminal-container');
    const xterm = document.querySelector('.xterm');
    const containerWidth = container ? container.getBoundingClientRect().width : 0;
    const xtermWidth = xterm ? xterm.getBoundingClientRect().width : 0;

    return { cols, rows, containerWidth, xtermWidth, cellWidth };
  });
}

async function runConfigArrowTest(config: TestConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('\n========================================');
  console.log('Config Arrow Key Navigation Test');
  console.log('========================================\n');
  console.log(`Width: ${config.testWidth}px`);
  console.log(`WebGL: ${config.noWebGL ? 'DISABLED' : 'enabled'}`);
  console.log(`Output: ${config.outputDir}`);
  console.log('');

  // Clean and create output directory
  if (existsSync(config.outputDir)) {
    rmSync(config.outputDir, { recursive: true });
  }
  mkdirSync(config.outputDir, { recursive: true });

  let browser: Browser | null = null;
  const results: { step: string; screenshot: string; termInfo?: { cols: number; rows: number } }[] = [];

  try {
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.headed ? 100 : 0, // Slow down for visibility
    });

    const page = await browser.newPage({
      viewport: { width: config.testWidth, height: config.testHeight },
    });

    // Capture console logs from the browser
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[Terminal]')) {
        console.log(`  BROWSER: ${text}`);
      }
    });

    const url = config.noWebGL ? `${config.baseUrl}?nowebgl=1` : config.baseUrl;
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await waitForTerminalReady(page);
    await focusTerminal(page);

    // Get initial terminal info
    const initialInfo = await getTerminalInfo(page);
    console.log(`Terminal size: ${initialInfo.cols}x${initialInfo.rows}`);
    console.log(`Container width: ${initialInfo.containerWidth}px`);
    console.log(`Xterm width: ${initialInfo.xtermWidth}px`);
    console.log(`Cell width: ${initialInfo.cellWidth}px`);
    if (initialInfo.cellWidth > 0) {
      const expectedCols = Math.floor(initialInfo.containerWidth / initialInfo.cellWidth);
      console.log(`Expected cols for container: ${expectedCols}`);
    }

    // Start Claude Code
    console.log('\nStarting Claude Code...');
    const started = await startClaudeCode(page);
    if (!started) {
      console.error('Failed to start Claude Code');
      const failPath = join(config.outputDir, '00-failed-start.png');
      await page.screenshot({ path: failPath });
      return;
    }

    // Screenshot before config
    const beforePath = join(config.outputDir, '01-before-config.png');
    await page.screenshot({ path: beforePath });
    results.push({ step: 'Before /config', screenshot: beforePath, termInfo: initialInfo });

    // Open /config
    console.log('\nOpening /config...');
    await page.keyboard.type('/config', { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000); // Wait for config UI to fully render

    const afterConfigPath = join(config.outputDir, '02-config-opened.png');
    await page.screenshot({ path: afterConfigPath });
    results.push({ step: 'Config opened', screenshot: afterConfigPath });

    // Test arrow key navigation - RIGHT arrows
    console.log('\nTesting RIGHT arrow navigation...');
    for (let i = 0; i < 6; i++) {
      console.log(`  Arrow RIGHT #${i + 1}`);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500); // Wait for TUI to redraw

      const arrowPath = join(config.outputDir, `03-arrow-right-${i + 1}.png`);
      await page.screenshot({ path: arrowPath });
      results.push({ step: `Arrow Right ${i + 1}`, screenshot: arrowPath });
    }

    // Test arrow key navigation - LEFT arrows
    console.log('\nTesting LEFT arrow navigation...');
    for (let i = 0; i < 6; i++) {
      console.log(`  Arrow LEFT #${i + 1}`);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(500);

      const arrowPath = join(config.outputDir, `04-arrow-left-${i + 1}.png`);
      await page.screenshot({ path: arrowPath });
      results.push({ step: `Arrow Left ${i + 1}`, screenshot: arrowPath });
    }

    // Test rapid arrow key presses
    console.log('\nTesting rapid arrow keys...');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100); // Fast but not instant
    }
    await page.waitForTimeout(1000); // Wait for any deferred rendering

    const rapidPath = join(config.outputDir, '05-after-rapid-arrows.png');
    await page.screenshot({ path: rapidPath });
    results.push({ step: 'After rapid arrows', screenshot: rapidPath });

    // Test UP/DOWN arrows
    console.log('\nTesting UP/DOWN arrows...');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(300);
    }
    const afterDownPath = join(config.outputDir, '06-after-down-arrows.png');
    await page.screenshot({ path: afterDownPath });
    results.push({ step: 'After down arrows', screenshot: afterDownPath });

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(300);
    }
    const afterUpPath = join(config.outputDir, '07-after-up-arrows.png');
    await page.screenshot({ path: afterUpPath });
    results.push({ step: 'After up arrows', screenshot: afterUpPath });

    // Exit config
    console.log('\nExiting config...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const exitPath = join(config.outputDir, '08-after-exit.png');
    await page.screenshot({ path: exitPath });
    results.push({ step: 'After exit', screenshot: exitPath });

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Write manifest
  const manifest = {
    timestamp: new Date().toISOString(),
    config,
    results,
  };
  writeFileSync(join(config.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\n========================================');
  console.log('Test Complete');
  console.log('========================================');
  console.log(`Screenshots saved to: ${config.outputDir}`);
  console.log(`Total steps: ${results.length}`);
}

// CLI entry point
runConfigArrowTest().catch(console.error);

export { runConfigArrowTest, TestConfig };
