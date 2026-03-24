/**
 * Duplicate Input Test - Detects if characters are being duplicated when typing
 *
 * This script tests for the issue where typing "t" results in "tt":
 * 1. Opens a terminal session
 * 2. Types a unique test string
 * 3. Captures terminal output
 * 4. Verifies each character appears exactly once
 *
 * Usage:
 *   pnpm duplicate-test              # Run with headless browser
 *   HEADED=true pnpm duplicate-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  headed: boolean;
  testIterations: number;
}

interface TestResult {
  iteration: number;
  inputString: string;
  outputString: string;
  hasDuplicates: boolean;
  duplicateDetails: string[];
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.duplicate-input-tests'),
  baseUrl: 'http://localhost:3001',
  headed: process.env.HEADED === 'true',
  testIterations: 5,
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

async function getTerminalContent(page: Page): Promise<string> {
  return await page.locator('.xterm-rows').first().textContent({ timeout: 2000 }).catch(() => '');
}

function generateTestString(): string {
  // Generate a unique test string with various characters
  const timestamp = Date.now().toString(36);
  return `test_${timestamp}_abc123`;
}

function detectDuplicates(input: string, output: string): { hasDuplicates: boolean; details: string[] } {
  const details: string[] = [];

  // Look for consecutive duplicate characters that match the input
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    // Count occurrences of this character being doubled in output
    const pattern = char + char;
    if (output.includes(pattern) && !input.includes(pattern)) {
      details.push(`Character '${char}' appears doubled as '${pattern}'`);
    }
  }

  // Also check if the entire string appears doubled
  const inputDoubled = input.split('').map(c => c + c).join('');
  if (output.includes(inputDoubled)) {
    details.push(`Entire input appears doubled`);
  }

  return {
    hasDuplicates: details.length > 0,
    details
  };
}

async function runSingleTest(page: Page, iteration: number): Promise<TestResult> {
  const testString = generateTestString();
  console.log(`\nIteration ${iteration}: Testing string "${testString}"`);

  // Clear any previous content
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(300);

  // Get content before typing
  const beforeContent = await getTerminalContent(page);

  // Type the test string with small delays between characters
  await page.keyboard.type(testString, { delay: 50 });
  await page.keyboard.press('Enter');

  // Wait for output to settle
  await page.waitForTimeout(500);

  // Get content after typing
  const afterContent = await getTerminalContent(page);

  // Extract the new content (what was added)
  const newContent = afterContent.replace(beforeContent, '');

  // Check for duplicates
  const { hasDuplicates, details } = detectDuplicates(testString, newContent);

  if (hasDuplicates) {
    console.log(`  ❌ DUPLICATES DETECTED:`);
    details.forEach(d => console.log(`     - ${d}`));
  } else {
    console.log(`  ✓ No duplicates detected`);
  }

  return {
    iteration,
    inputString: testString,
    outputString: newContent,
    hasDuplicates,
    duplicateDetails: details
  };
}

async function runDuplicateInputTest(config: TestConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('\n========================================');
  console.log('Duplicate Input Detection Test');
  console.log('========================================\n');
  console.log(`Iterations: ${config.testIterations}`);
  console.log(`Output: ${config.outputDir}`);
  console.log('');

  // Clean and create output directory
  if (existsSync(config.outputDir)) {
    rmSync(config.outputDir, { recursive: true });
  }
  mkdirSync(config.outputDir, { recursive: true });

  let browser: Browser | null = null;
  const results: TestResult[] = [];
  const consoleLogs: string[] = [];

  try {
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.headed ? 50 : 0,
    });

    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
    });

    // Capture console logs from the browser
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('[Terminal:')) {
        console.log(`  BROWSER: ${text}`);
      }
    });

    console.log(`Navigating to ${config.baseUrl}...`);
    await page.goto(config.baseUrl, { waitUntil: 'networkidle' });
    await waitForTerminalReady(page);
    await focusTerminal(page);

    // Take initial screenshot
    await page.screenshot({ path: join(config.outputDir, '00-initial.png') });

    // Run multiple iterations
    for (let i = 1; i <= config.testIterations; i++) {
      const result = await runSingleTest(page, i);
      results.push(result);

      // Take screenshot after each test
      await page.screenshot({ path: join(config.outputDir, `${String(i).padStart(2, '0')}-after-test.png`) });

      // Small delay between tests
      await page.waitForTimeout(300);
    }

    // Final screenshot
    await page.screenshot({ path: join(config.outputDir, 'final.png') });

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Write results
  const manifest = {
    timestamp: new Date().toISOString(),
    config,
    results,
    consoleLogs,
    summary: {
      totalTests: results.length,
      testsWithDuplicates: results.filter(r => r.hasDuplicates).length,
      allPassed: results.every(r => !r.hasDuplicates)
    }
  };
  writeFileSync(join(config.outputDir, 'results.json'), JSON.stringify(manifest, null, 2));

  // Summary
  console.log('\n========================================');
  console.log('Test Complete');
  console.log('========================================');
  console.log(`Total tests: ${results.length}`);
  console.log(`Tests with duplicates: ${results.filter(r => r.hasDuplicates).length}`);

  if (manifest.summary.allPassed) {
    console.log('\n✅ ALL TESTS PASSED - No duplicate input detected');
  } else {
    console.log('\n❌ SOME TESTS FAILED - Duplicate input detected');
    console.log('\nFailed tests:');
    results.filter(r => r.hasDuplicates).forEach(r => {
      console.log(`  Iteration ${r.iteration}:`);
      r.duplicateDetails.forEach(d => console.log(`    - ${d}`));
    });
  }

  // Show relevant console logs
  const terminalLogs = consoleLogs.filter(l => l.includes('[Terminal:'));
  if (terminalLogs.length > 0) {
    console.log('\nTerminal debug logs:');
    terminalLogs.slice(-20).forEach(l => console.log(`  ${l}`));
  }

  console.log(`\nResults saved to: ${config.outputDir}`);
}

// CLI entry point
runDuplicateInputTest().catch(console.error);

export { runDuplicateInputTest, TestConfig };
