/**
 * Typing Duplication Detection Test
 *
 * This script tests for input duplication issues by:
 * 1. Connecting to a terminal session
 * 2. Typing a known test string
 * 3. Capturing the output to detect if characters were duplicated
 *
 * Usage:
 *   pnpm typing-test           # Run with headless browser
 *   HEADED=true pnpm typing-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestResult {
  timestamp: string;
  testString: string;
  receivedContent: string;
  hasDuplication: boolean;
  screenshots: string[];
  errors: string[];
}

const OUTPUT_DIR = join(process.cwd(), '.typing-tests');
const BASE_URL = 'http://localhost:3001';
const HEADED = process.env.HEADED === 'true';

// Test string - easy to detect duplications
const TEST_STRING = 'abcdefghij';

async function waitForTerminal(page: Page): Promise<boolean> {
  try {
    await page.waitForSelector('.xterm-rows', { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function dragFirstSessionToPane(page: Page): Promise<boolean> {
  const sessionItem = page.locator('.terminal-item').first();
  const sessionBox = await sessionItem.boundingBox();
  if (!sessionBox) return false;

  const pane = page.locator('.pane, .empty-pane').first();
  const paneBox = await pane.boundingBox();
  if (!paneBox) return false;

  await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  return true;
}

async function clearLine(page: Page): Promise<void> {
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+u');
  await page.waitForTimeout(100);
}

async function getTerminalContent(page: Page): Promise<string> {
  try {
    return await page.locator('.xterm-rows').first().textContent() || '';
  } catch {
    return '';
  }
}

function detectDuplication(testString: string, content: string): { hasDuplication: boolean; details: string } {
  // Look for the test string or duplicated versions of it
  const lines = content.split('\n');

  for (const line of lines) {
    // Check if the line contains our test string
    if (line.includes(testString)) {
      return { hasDuplication: false, details: `Found exact match: "${testString}"` };
    }

    // Check for duplicated characters pattern
    // e.g., "aabbccdd" instead of "abcd"
    let possibleDuplication = '';
    for (const char of testString) {
      possibleDuplication += char + char; // Double each character
    }
    if (line.includes(possibleDuplication)) {
      return { hasDuplication: true, details: `Found doubled characters: "${possibleDuplication}"` };
    }

    // Check for any substring that looks like repeated characters from our test
    for (let i = 0; i < testString.length - 2; i++) {
      const substr = testString.slice(i, i + 3);
      // Check if these 3 chars appear but with duplications
      const duplicatedPattern = new RegExp(substr.split('').map(c => c + '+').join(''));
      const match = line.match(duplicatedPattern);
      if (match && match[0].length > substr.length) {
        return {
          hasDuplication: true,
          details: `Found duplicated pattern: expected "${substr}", got "${match[0]}"`
        };
      }
    }
  }

  return { hasDuplication: false, details: 'No duplication detected' };
}

async function runTypingTest(): Promise<TestResult> {
  console.log('\n========================================');
  console.log('Typing Duplication Detection Test');
  console.log('========================================\n');
  console.log(`Test string: "${TEST_STRING}"`);
  console.log(`Headed mode: ${HEADED}`);
  console.log('');

  // Clean and create output directory
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true });
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const result: TestResult = {
    timestamp: new Date().toISOString(),
    testString: TEST_STRING,
    receivedContent: '',
    hasDuplication: false,
    screenshots: [],
    errors: [],
  };

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: !HEADED,
      slowMo: HEADED ? 30 : 0,
    });

    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });

    console.log('Navigating to app...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });

    // Check for terminal
    let hasTerminal = await waitForTerminal(page);

    if (!hasTerminal) {
      console.log('No terminal visible, dragging session to pane...');
      await dragFirstSessionToPane(page);
      await page.waitForTimeout(500);
      hasTerminal = await waitForTerminal(page);
    }

    if (!hasTerminal) {
      result.errors.push('Could not find terminal');
      return result;
    }

    // Focus terminal
    await page.locator('.xterm-rows').first().click();
    await page.waitForTimeout(300);

    // Clear line
    console.log('Clearing terminal line...');
    await clearLine(page);
    await page.waitForTimeout(200);

    // Capture before state
    const beforePath = join(OUTPUT_DIR, 'before-typing.png');
    await page.screenshot({ path: beforePath });
    result.screenshots.push(beforePath);

    // Get content before typing
    const contentBefore = await getTerminalContent(page);
    console.log(`Content before (last 100 chars): "${contentBefore.slice(-100).replace(/\n/g, '\\n')}"`);

    // Type the test string with echo command
    console.log(`Typing: echo "${TEST_STRING}"`);
    await page.keyboard.type(`echo "${TEST_STRING}"`, { delay: 50 });

    await page.waitForTimeout(300);

    // Capture after typing (before Enter)
    const afterTypePath = join(OUTPUT_DIR, 'after-typing.png');
    await page.screenshot({ path: afterTypePath });
    result.screenshots.push(afterTypePath);

    // Get content after typing
    const contentAfterType = await getTerminalContent(page);
    console.log(`Content after typing (last 200 chars): "${contentAfterType.slice(-200).replace(/\n/g, '\\n')}"`);

    // Press Enter to execute
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Capture final state
    const finalPath = join(OUTPUT_DIR, 'after-enter.png');
    await page.screenshot({ path: finalPath });
    result.screenshots.push(finalPath);

    // Get final content
    const contentFinal = await getTerminalContent(page);
    result.receivedContent = contentFinal;

    console.log(`\nFinal content (last 300 chars):\n"${contentFinal.slice(-300).replace(/\n/g, '\\n')}"`);

    // Analyze for duplication
    const analysis = detectDuplication(TEST_STRING, contentFinal);
    result.hasDuplication = analysis.hasDuplication;

    console.log(`\nDuplication analysis: ${analysis.details}`);

    if (result.hasDuplication) {
      console.log('\n*** DUPLICATION DETECTED ***');
      result.errors.push('Typing duplication detected');
    } else {
      console.log('\nNo duplication detected in this test run.');
    }

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMsg);
    console.error('Test error:', errorMsg);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // Write result
  const manifestPath = join(OUTPUT_DIR, 'test-result.json');
  writeFileSync(manifestPath, JSON.stringify(result, null, 2));

  console.log('\n========================================');
  console.log('Test Complete');
  console.log('========================================');
  console.log(`Duplication detected: ${result.hasDuplication}`);
  console.log(`Screenshots: ${result.screenshots.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`\nResults saved to: ${OUTPUT_DIR}`);

  return result;
}

runTypingTest().catch(console.error);

export { runTypingTest };
