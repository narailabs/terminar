/**
 * Width Threshold Test - Finds the exact width where UI breaks
 *
 * This script tests terminal rendering at fine-grained width intervals
 * to identify exactly where visual corruption begins.
 *
 * Usage:
 *   pnpm width-threshold          # Run with headless browser
 *   HEADED=true pnpm width-threshold  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  headed: boolean;
  startWidth: number;
  endWidth: number;
  stepSize: number;
}

interface WidthResult {
  width: number;
  cols: number;
  rows: number;
  screenshot: string;
  hasCorruption: boolean;
  corruptionDetails: string[];
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.width-threshold-tests'),
  baseUrl: 'http://localhost:3001',
  headed: process.env.HEADED === 'true',
  startWidth: 1200,
  endWidth: 2600,
  stepSize: 100,
};

async function waitForTerminalReady(page: Page, timeout = 15000): Promise<void> {
  console.log('Waiting for terminal to be ready...');
  try {
    await page.waitForSelector('.xterm-rows, .terminal-container, .xterm, .workspace-view', { timeout });
  } catch {
    console.log('Primary selectors not found, trying fallback...');
    await page.waitForSelector('.app, .main-area', { timeout: 5000 });
  }
  await page.waitForTimeout(1500);
}

async function focusTerminal(page: Page): Promise<boolean> {
  // Try clicking on terminal directly
  const terminal = page.locator('.xterm-rows').first();
  if (await terminal.count() > 0) {
    await terminal.click();
    await page.waitForTimeout(200);
    return true;
  }

  // Try dragging a session to the pane
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

      const terminalAfterDrag = page.locator('.xterm-rows').first();
      if (await terminalAfterDrag.count() > 0) {
        await terminalAfterDrag.click();
        return true;
      }
    }
  }
  return false;
}

async function getTerminalInfo(page: Page): Promise<{ cols: number; rows: number; containerWidth: number }> {
  return await page.evaluate(() => {
    // Get actual terminal dimensions from xterm
    const xtermCore = document.querySelector('.xterm') as any;
    let cols = 80, rows = 24;

    // Try to access terminal through various methods
    if (xtermCore && xtermCore._core) {
      cols = xtermCore._core._bufferService?.cols || cols;
      rows = xtermCore._core._bufferService?.rows || rows;
    }

    // Fallback: estimate from DOM
    const rowsContainer = document.querySelector('.xterm-rows');
    if (rowsContainer) {
      const rowElements = rowsContainer.querySelectorAll(':scope > div');
      if (rowElements.length > 0) {
        rows = rowElements.length;
        // Get first row's text content to estimate cols
        const firstRow = rowElements[0];
        if (firstRow) {
          const style = window.getComputedStyle(firstRow);
          const charWidth = parseFloat(style.fontSize) * 0.6; // approximate
          cols = Math.floor(rowsContainer.clientWidth / charWidth);
        }
      }
    }

    const container = document.querySelector('.terminal-container');
    const containerWidth = container ? container.clientWidth : 0;

    return { cols, rows, containerWidth };
  });
}

async function checkForVisualCorruption(page: Page): Promise<{ hasCorruption: boolean; details: string[] }> {
  const details: string[] = [];

  // Check for multiple spinner elements (sign of corruption)
  const spinnerCount = await page.locator('.xterm-rows').locator('text=⚙').count();
  if (spinnerCount > 2) {
    details.push(`Multiple spinners detected: ${spinnerCount}`);
  }

  // Check for overlapping elements by looking at xterm screen positioning
  const hasOverlap = await page.evaluate(() => {
    const screen = document.querySelector('.xterm-screen');
    const viewport = document.querySelector('.xterm-viewport');
    if (screen && viewport) {
      const screenRect = screen.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      // Check if screen extends beyond viewport
      if (screenRect.width > viewportRect.width + 10) {
        return { overlap: true, screenWidth: screenRect.width, viewportWidth: viewportRect.width };
      }
    }
    return { overlap: false, screenWidth: 0, viewportWidth: 0 };
  });

  if (hasOverlap.overlap) {
    details.push(`Screen overflow: screen=${hasOverlap.screenWidth}px, viewport=${hasOverlap.viewportWidth}px`);
  }

  // Check for terminal container vs terminal mismatch
  const sizeMismatch = await page.evaluate(() => {
    const container = document.querySelector('.terminal-container');
    const xterm = document.querySelector('.xterm');
    if (container && xterm) {
      const containerRect = container.getBoundingClientRect();
      const xtermRect = xterm.getBoundingClientRect();
      const widthDiff = Math.abs(containerRect.width - xtermRect.width);
      if (widthDiff > 50) {
        return { mismatch: true, containerWidth: containerRect.width, xtermWidth: xtermRect.width };
      }
    }
    return { mismatch: false, containerWidth: 0, xtermWidth: 0 };
  });

  if (sizeMismatch.mismatch) {
    details.push(`Size mismatch: container=${sizeMismatch.containerWidth}px, xterm=${sizeMismatch.xtermWidth}px`);
  }

  return {
    hasCorruption: details.length > 0,
    details
  };
}

async function testWidth(page: Page, width: number, config: TestConfig): Promise<WidthResult> {
  console.log(`\nTesting width: ${width}px`);

  // Resize viewport
  await page.setViewportSize({ width, height: 800 });
  await page.waitForTimeout(500); // Wait for resize debounce

  // Get terminal info
  const termInfo = await getTerminalInfo(page);
  console.log(`  Terminal: ${termInfo.cols}x${termInfo.rows}, container: ${termInfo.containerWidth}px`);

  // Check for corruption
  const corruption = await checkForVisualCorruption(page);
  if (corruption.hasCorruption) {
    console.log(`  ⚠️  Corruption detected: ${corruption.details.join(', ')}`);
  }

  // Capture screenshot
  const screenshotPath = join(config.outputDir, `width-${width}.png`);
  await page.screenshot({ path: screenshotPath });

  return {
    width,
    cols: termInfo.cols,
    rows: termInfo.rows,
    screenshot: screenshotPath,
    hasCorruption: corruption.hasCorruption,
    corruptionDetails: corruption.details
  };
}

async function runWidthThresholdTest(config: TestConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('\n========================================');
  console.log('Width Threshold Test');
  console.log('========================================\n');
  console.log(`Testing widths from ${config.startWidth}px to ${config.endWidth}px (step: ${config.stepSize}px)`);
  console.log(`Output: ${config.outputDir}`);
  console.log('');

  // Clean and create output directory
  if (existsSync(config.outputDir)) {
    rmSync(config.outputDir, { recursive: true });
  }
  mkdirSync(config.outputDir, { recursive: true });

  const results: WidthResult[] = [];
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.headed ? 50 : 0,
    });

    const page = await browser.newPage({
      viewport: { width: config.startWidth, height: 800 },
    });

    await page.goto(config.baseUrl, { waitUntil: 'networkidle' });
    await waitForTerminalReady(page);
    await focusTerminal(page);

    // Test each width
    for (let width = config.startWidth; width <= config.endWidth; width += config.stepSize) {
      const result = await testWidth(page, width, config);
      results.push(result);
    }

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Find threshold where corruption starts
  const firstCorruption = results.find(r => r.hasCorruption);
  const lastClean = [...results].reverse().find(r => !r.hasCorruption);

  console.log('\n========================================');
  console.log('Results Summary');
  console.log('========================================');

  console.log('\nAll results:');
  for (const r of results) {
    const status = r.hasCorruption ? '❌' : '✅';
    console.log(`  ${status} ${r.width}px - ${r.cols} cols${r.hasCorruption ? ' - ' + r.corruptionDetails.join(', ') : ''}`);
  }

  console.log('\n--- Threshold Analysis ---');
  if (firstCorruption) {
    console.log(`First corruption at: ${firstCorruption.width}px (${firstCorruption.cols} cols)`);
  } else {
    console.log('No corruption detected in tested range');
  }

  if (lastClean) {
    console.log(`Last clean width: ${lastClean.width}px (${lastClean.cols} cols)`);
  }

  // Write results
  const manifest = {
    timestamp: new Date().toISOString(),
    config,
    results,
    threshold: firstCorruption ? firstCorruption.width : null,
    lastCleanWidth: lastClean ? lastClean.width : null
  };

  writeFileSync(join(config.outputDir, 'results.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nResults saved to: ${config.outputDir}`);
}

// CLI entry point
runWidthThresholdTest().catch(console.error);

export { runWidthThresholdTest, TestConfig };
