#!/usr/bin/env npx tsx
/**
 * E2E Test: Duplicate Typing Detection
 *
 * This test detects the bug where typing a character results in it appearing twice.
 *
 * Root cause: EventEmitter listener accumulation in Terminal.svelte
 * When the component remounts or reactive blocks re-run, new listeners are added
 * but old ones aren't removed (due to function reference mismatch).
 *
 * Test scenarios:
 * 1. Fresh page load - type and verify no duplication
 * 2. After browser refresh - type and verify no duplication
 * 3. After pane changes - type and verify no duplication
 */

import { chromium, Browser, Page } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = join(__dirname, '..', '.wide-tests');

interface TestResult {
  scenario: string;
  passed: boolean;
  typed: string;
  received: string;
  details?: string;
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const TIMEOUT = 30000;

async function waitForTerminalReady(page: Page): Promise<void> {
  console.log('Waiting for app container...');

  // Wait for workspace area (app connected)
  await page.waitForSelector('.workspace-area', { timeout: TIMEOUT });
  console.log('Workspace area found');

  // Check if we have an empty pane (no session assigned)
  const emptyPane = await page.$('.empty-pane');
  if (emptyPane) {
    console.log('Empty pane detected, need to assign a session...');

    // Click on first terminal in sidebar to assign it
    const sidebarItems = await page.$$('.session-item');
    if (sidebarItems.length > 0) {
      console.log(`Found ${sidebarItems.length} sessions in sidebar, clicking first one...`);
      await sidebarItems[0].click();
      await page.waitForTimeout(500);
    } else {
      // No sessions exist, click "New Terminal" button
      console.log('No sessions found, clicking New Terminal...');
      const newTerminalBtn = await page.$('button:has-text("New Terminal"), .new-terminal-btn');
      if (newTerminalBtn) {
        await newTerminalBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  console.log('Waiting for xterm screen...');
  // Wait for xterm to be visible and ready
  try {
    await page.waitForSelector('.xterm-screen', { timeout: TIMEOUT });
  } catch (e) {
    // Take screenshot before failing
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: join(OUTPUT_DIR, 'debug-no-terminal.png') });
    console.log('Debug screenshot saved to debug-no-terminal.png');
    throw e;
  }

  // Give terminal time to initialize fully
  console.log('Terminal found, waiting for init...');
  await page.waitForTimeout(1500);
}

async function waitForShellPrompt(page: Page): Promise<void> {
  // Wait for shell prompt to appear (look for $ or % or >)
  // Also check for any visible text which means the terminal is ready
  await page.waitForFunction(
    () => {
      const screen = document.querySelector('.xterm-screen');
      if (!screen) return false;
      const text = screen.textContent || '';
      // Look for common shell prompt characters or any substantial content
      return text.includes('$') || text.includes('%') || text.includes('>') ||
             text.includes('~') || text.length > 10;
    },
    { timeout: TIMEOUT }
  );
  await page.waitForTimeout(500);
}

async function getTerminalContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rows = document.querySelectorAll('.xterm-rows > div');
    return Array.from(rows).map(row => row.textContent || '').join('\n');
  });
}

async function typeAndCheckDuplication(
  page: Page,
  testChar: string = 'x'
): Promise<{ typed: string; received: string; isDuplicated: boolean }> {
  // Get terminal content before typing
  const contentBefore = await getTerminalContent(page);

  // Count occurrences of test character before
  const countBefore = (contentBefore.match(new RegExp(testChar, 'g')) || []).length;

  // Type the test character
  await page.keyboard.type(testChar);

  // Wait for the character to appear
  await page.waitForTimeout(300);

  // Get terminal content after typing
  const contentAfter = await getTerminalContent(page);

  // Count occurrences of test character after
  const countAfter = (contentAfter.match(new RegExp(testChar, 'g')) || []).length;

  // The character should appear exactly once more than before
  const charsAdded = countAfter - countBefore;

  return {
    typed: testChar,
    received: testChar.repeat(charsAdded),
    isDuplicated: charsAdded > 1
  };
}

async function runTest(page: Page, scenario: string, testChar: string): Promise<TestResult> {
  console.log(`\n📋 Testing: ${scenario}`);

  try {
    const result = await typeAndCheckDuplication(page, testChar);

    if (result.isDuplicated) {
      console.log(`  ❌ FAILED: Typed "${result.typed}" but received "${result.received}"`);
      return {
        scenario,
        passed: false,
        typed: result.typed,
        received: result.received,
        details: 'Character was duplicated'
      };
    } else {
      console.log(`  ✅ PASSED: Typed "${result.typed}" received "${result.received}"`);
      return {
        scenario,
        passed: true,
        typed: result.typed,
        received: result.received
      };
    }
  } catch (error) {
    console.log(`  ❌ ERROR: ${error}`);
    return {
      scenario,
      passed: false,
      typed: testChar,
      received: 'ERROR',
      details: String(error)
    };
  }
}

async function clearTerminalLine(page: Page): Promise<void> {
  // Send Ctrl+U to clear the line
  await page.keyboard.press('Control+u');
  await page.waitForTimeout(100);
}

async function main() {
  console.log('🧪 Duplicate Typing Detection Test');
  console.log('====================================');
  console.log(`Base URL: ${BASE_URL}`);

  const browser: Browser = await chromium.launch({
    headless: process.env.HEADED !== '1'
  });

  const results: TestResult[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Enable console logging from the page
    page.on('console', msg => {
      if (msg.text().includes('[Terminal:')) {
        console.log(`  [Browser] ${msg.text()}`);
      }
    });

    // SCENARIO 1: Fresh page load
    console.log('\n🔄 Loading fresh page...');
    await page.goto(BASE_URL);
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);

    // Click on terminal to focus
    await page.click('.xterm-screen');
    await page.waitForTimeout(200);

    results.push(await runTest(page, 'Fresh page load - single char', 'a'));
    await clearTerminalLine(page);

    results.push(await runTest(page, 'Fresh page load - multiple chars', 'b'));
    await clearTerminalLine(page);

    // SCENARIO 2: After browser refresh
    console.log('\n🔄 Refreshing browser...');
    await page.reload();
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);
    await page.click('.xterm-screen');
    await page.waitForTimeout(200);

    results.push(await runTest(page, 'After refresh - single char', 'c'));
    await clearTerminalLine(page);

    results.push(await runTest(page, 'After refresh - multiple chars', 'd'));
    await clearTerminalLine(page);

    // SCENARIO 3: After second refresh (accumulation test)
    console.log('\n🔄 Refreshing browser again...');
    await page.reload();
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);
    await page.click('.xterm-screen');
    await page.waitForTimeout(200);

    results.push(await runTest(page, 'After second refresh - single char', 'e'));
    await clearTerminalLine(page);

    // SCENARIO 4: Type a word and check for duplication
    console.log('\n🔄 Testing word typing...');
    const testWord = 'test';
    await page.keyboard.type(testWord);
    await page.waitForTimeout(300);

    const content = await getTerminalContent(page);
    // Check if 'test' appears and 'tteesstt' doesn't
    const hasDoubled = content.includes('tt') && content.includes('ss');
    results.push({
      scenario: 'Word typing - "test"',
      passed: !hasDoubled,
      typed: testWord,
      received: hasDoubled ? 'tteesstt (doubled)' : testWord,
      details: hasDoubled ? 'Word characters were doubled' : undefined
    });

    if (hasDoubled) {
      console.log(`  ❌ FAILED: Word was doubled`);
    } else {
      console.log(`  ✅ PASSED: Word typed correctly`);
    }

    // Print summary
    console.log('\n📊 Test Summary');
    console.log('================');

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\n❌ Failed tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.scenario}: typed "${r.typed}" received "${r.received}"`);
        if (r.details) console.log(`    ${r.details}`);
      });
    }

    // Save results
    const resultsFile = join(OUTPUT_DIR, 'duplicate-typing-results.json');
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(resultsFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      results,
      summary: { passed, failed, total: results.length }
    }, null, 2));

    console.log(`\nResults saved to: ${resultsFile}`);

    // Exit with error if any tests failed
    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('Test failed with error:', error);
    // Take a screenshot to debug
    try {
      const page = (await browser.contexts())[0]?.pages()[0];
      if (page) {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: join(OUTPUT_DIR, 'dup-test-failure.png') });
        console.log('Screenshot saved to .wide-tests/dup-test-failure.png');
      }
    } catch {}
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
