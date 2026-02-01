#!/usr/bin/env npx tsx
/**
 * E2E Test: Duplicate Typing After Refresh (Same Session)
 *
 * This tests the ACTUAL user scenario:
 * 1. Open app, connect to existing session (or create one)
 * 2. Type a character - verify no duplication
 * 3. Refresh the browser
 * 4. Re-attach to the SAME session
 * 5. Type a character - verify no duplication
 *
 * The root cause of the bug is that after browser refresh:
 * - Old WebSocket connection's forwarder task on the server keeps running
 * - New WebSocket connection creates a NEW forwarder task
 * - Both forward the same output, causing duplication
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
  await page.waitForSelector('.workspace-area', { timeout: TIMEOUT });
  console.log('Workspace area found');

  // Check if we have an empty pane
  const emptyPane = await page.$('.empty-pane');
  if (emptyPane) {
    console.log('Empty pane detected, looking for sessions to attach...');

    // Click on first terminal in sidebar to assign it
    const sidebarItems = await page.$$('.session-item');
    if (sidebarItems.length > 0) {
      console.log(`Found ${sidebarItems.length} existing sessions, clicking first one...`);
      await sidebarItems[0].click();
      await page.waitForTimeout(500);
    } else {
      // No sessions exist, create one
      console.log('No sessions found, clicking New Terminal...');
      const newTerminalBtn = await page.$('button:has-text("New Terminal"), .new-terminal-btn');
      if (newTerminalBtn) {
        await newTerminalBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  console.log('Waiting for xterm screen...');
  try {
    await page.waitForSelector('.xterm-screen', { timeout: TIMEOUT });
  } catch (e) {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: join(OUTPUT_DIR, 'debug-no-terminal.png') });
    console.log('Debug screenshot saved');
    throw e;
  }

  console.log('Terminal found, waiting for init...');
  await page.waitForTimeout(1500);
}

async function waitForShellPrompt(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const screen = document.querySelector('.xterm-screen');
      if (!screen) return false;
      const text = screen.textContent || '';
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

async function getActiveSessionId(page: Page): Promise<string | null> {
  // Try to get the session ID from the sidebar's selected item
  return page.evaluate(() => {
    const activeItem = document.querySelector('.session-item.selected, .session-item.active');
    return activeItem?.getAttribute('data-session-id') || null;
  });
}

async function typeAndCheckDuplication(
  page: Page,
  testChar: string = 'x'
): Promise<{ typed: string; received: string; isDuplicated: boolean }> {
  const contentBefore = await getTerminalContent(page);
  const countBefore = (contentBefore.match(new RegExp(testChar, 'g')) || []).length;

  await page.keyboard.type(testChar);
  await page.waitForTimeout(500); // Longer wait to catch delayed duplicates

  const contentAfter = await getTerminalContent(page);
  const countAfter = (contentAfter.match(new RegExp(testChar, 'g')) || []).length;

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
  await page.keyboard.press('Control+u');
  await page.waitForTimeout(100);
}

async function main() {
  console.log('🧪 Duplicate Typing After Refresh (Same Session) Test');
  console.log('=====================================================');
  console.log(`Base URL: ${BASE_URL}`);

  const browser: Browser = await chromium.launch({
    headless: process.env.HEADED !== '1'
  });

  const results: TestResult[] = [];
  let sessionIdToReuse: string | null = null;

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    // Enable console logging
    page.on('console', msg => {
      if (msg.text().includes('[Terminal:') || msg.text().includes('[WS]')) {
        console.log(`  [Browser] ${msg.text()}`);
      }
    });

    // PHASE 1: Initial load
    console.log('\n🔄 Phase 1: Loading fresh page...');
    await page.goto(BASE_URL);
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);
    await page.click('.xterm-screen');
    await page.waitForTimeout(200);

    results.push(await runTest(page, 'Initial load - before any refresh', 'a'));
    await clearTerminalLine(page);

    // Try to get the session ID for later reuse
    sessionIdToReuse = await getActiveSessionId(page);
    console.log(`\nSession ID for reuse: ${sessionIdToReuse || 'not available'}`);

    // PHASE 2: First refresh - reconnect to SAME session
    console.log('\n🔄 Phase 2: Refreshing browser (same session)...');
    await page.reload();
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);
    await page.click('.xterm-screen');
    await page.waitForTimeout(200);

    // Verify we're on the same session (if we could track it)
    const currentSessionId = await getActiveSessionId(page);
    console.log(`Current session ID: ${currentSessionId || 'not available'}`);

    results.push(await runTest(page, 'After 1st refresh - same session', 'b'));
    await clearTerminalLine(page);

    // PHASE 3: Second refresh - should still work
    console.log('\n🔄 Phase 3: Refreshing browser again...');
    await page.reload();
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);
    await page.click('.xterm-screen');
    await page.waitForTimeout(200);

    results.push(await runTest(page, 'After 2nd refresh - same session', 'c'));
    await clearTerminalLine(page);

    // PHASE 4: Rapid refresh test
    console.log('\n🔄 Phase 4: Rapid refresh test (stress test)...');
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await page.waitForTimeout(100); // Very quick succession
    }
    await waitForTerminalReady(page);
    await waitForShellPrompt(page);
    await page.click('.xterm-screen');
    await page.waitForTimeout(500); // Extra wait after rapid refreshes

    results.push(await runTest(page, 'After rapid refreshes', 'd'));
    await clearTerminalLine(page);

    // PHASE 5: Type a word
    console.log('\n🔄 Phase 5: Word typing test...');
    const testWord = 'test';
    await page.keyboard.type(testWord);
    await page.waitForTimeout(500);

    const content = await getTerminalContent(page);
    const hasDoubled = content.includes('tteesstt') ||
                      (content.split('t').length - 1 > testWord.split('t').length * 2);

    results.push({
      scenario: 'Word typing - "test"',
      passed: !hasDoubled,
      typed: testWord,
      received: hasDoubled ? 'doubled' : testWord,
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
    const resultsFile = join(OUTPUT_DIR, 'refresh-same-session-results.json');
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.writeFile(resultsFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      results,
      summary: { passed, failed, total: results.length }
    }, null, 2));

    console.log(`\nResults saved to: ${resultsFile}`);

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('Test failed with error:', error);
    try {
      const page = (await browser.contexts())[0]?.pages()[0];
      if (page) {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        await page.screenshot({ path: join(OUTPUT_DIR, 'refresh-same-session-failure.png') });
        console.log('Screenshot saved');
      }
    } catch {}
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
