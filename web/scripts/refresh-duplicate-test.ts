/**
 * Refresh Duplicate Test - Tests for duplicate input after browser refresh
 *
 * This script specifically tests the scenario reported:
 * 1. Open terminal in pane
 * 2. Refresh the browser
 * 3. Add the terminal back to the pane
 * 4. Type and see if characters are duplicated
 *
 * Usage:
 *   pnpm refresh-test              # Run with headless browser
 *   HEADED=true pnpm refresh-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  headed: boolean;
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.refresh-duplicate-tests'),
  baseUrl: 'http://localhost:3001',
  headed: process.env.HEADED === 'true',
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

  if (count === 0) {
    console.log('No session items found');
    return false;
  }

  for (let i = 0; i < count; i++) {
    const item = sessionItems.nth(i);
    const text = await item.textContent();
    console.log(`Found session: ${text}`);
    if (text && text.toLowerCase().includes('zsh')) {
      const sessionBox = await item.boundingBox();
      if (!sessionBox) continue;

      const pane = page.locator('.pane, .empty-pane').first();
      const paneBox = await pane.boundingBox();
      if (!paneBox) continue;

      console.log('Dragging session to pane...');
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
  return false;
}

async function getTerminalContent(page: Page): Promise<string> {
  return await page.locator('.xterm-rows').first().textContent({ timeout: 2000 }).catch(() => '');
}

function checkForDuplicates(typed: string, content: string): { hasDuplicates: boolean; details: string[] } {
  const details: string[] = [];

  // Check for doubled characters
  for (const char of typed) {
    if (char === ' ' || char === '\n') continue;
    const doubled = char + char;
    // Count occurrences in content vs in typed string
    const contentDoubledCount = (content.match(new RegExp(doubled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const typedDoubledCount = (typed.match(new RegExp(doubled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (contentDoubledCount > typedDoubledCount) {
      details.push(`Character '${char}' appears doubled more times in output than expected`);
    }
  }

  return { hasDuplicates: details.length > 0, details };
}

async function runRefreshDuplicateTest(config: TestConfig = DEFAULT_CONFIG): Promise<void> {
  console.log('\n========================================');
  console.log('Refresh Duplicate Test');
  console.log('========================================\n');
  console.log(`Output: ${config.outputDir}`);
  console.log('');

  // Clean and create output directory
  if (existsSync(config.outputDir)) {
    rmSync(config.outputDir, { recursive: true });
  }
  mkdirSync(config.outputDir, { recursive: true });

  let browser: Browser | null = null;
  const consoleLogs: string[] = [];

  try {
    browser = await chromium.launch({
      headless: !config.headed,
      slowMo: config.headed ? 50 : 0,
    });

    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
    });

    let page = await context.newPage();

    // Capture console logs
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('[Terminal:') || text.includes('[WS]')) {
        console.log(`  BROWSER: ${text}`);
      }
    });

    // ===== PHASE 1: Initial setup =====
    console.log('\n--- Phase 1: Initial Setup ---');
    console.log(`Navigating to ${config.baseUrl}...`);
    await page.goto(config.baseUrl, { waitUntil: 'networkidle' });
    await waitForTerminalReady(page);

    // Drag session to pane
    console.log('Adding terminal to pane...');
    const dragged1 = await dragSessionToPane(page);
    if (!dragged1) {
      console.log('Failed to drag session to pane');
      await page.screenshot({ path: join(config.outputDir, '01-no-session.png') });
      return;
    }

    await focusTerminal(page);
    await page.screenshot({ path: join(config.outputDir, '01-initial-setup.png') });

    // Type something to verify it works
    console.log('Typing initial test...');
    const testString1 = 'beforerefresh';
    await page.keyboard.type(testString1, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const content1 = await getTerminalContent(page);
    console.log(`Terminal content after initial typing: "${content1.slice(-100)}"`);
    await page.screenshot({ path: join(config.outputDir, '02-after-initial-typing.png') });

    // ===== PHASE 2: Refresh browser =====
    console.log('\n--- Phase 2: Refresh Browser ---');
    console.log('Refreshing page...');
    await page.reload({ waitUntil: 'networkidle' });
    await waitForTerminalReady(page);
    await page.screenshot({ path: join(config.outputDir, '03-after-refresh.png') });

    // ===== PHASE 3: Re-add terminal =====
    console.log('\n--- Phase 3: Re-add Terminal ---');
    console.log('Adding terminal to pane again...');
    const dragged2 = await dragSessionToPane(page);
    if (!dragged2) {
      console.log('Failed to drag session to pane after refresh');
      await page.screenshot({ path: join(config.outputDir, '04-no-session-after-refresh.png') });
      return;
    }

    await focusTerminal(page);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(config.outputDir, '04-after-re-add.png') });

    // ===== PHASE 4: Type and check for duplicates =====
    console.log('\n--- Phase 4: Test for Duplicates ---');

    // Clear line first
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+l');
    await page.waitForTimeout(500);

    const testString2 = 'afterrefresh123';
    console.log(`Typing: "${testString2}"`);

    // Type slowly and check
    for (const char of testString2) {
      await page.keyboard.type(char);
      await page.waitForTimeout(100);
    }

    await page.waitForTimeout(500);
    const content2 = await getTerminalContent(page);
    console.log(`Terminal content: "${content2.slice(-150)}"`);
    await page.screenshot({ path: join(config.outputDir, '05-after-test-typing.png') });

    // Check for duplicates
    const { hasDuplicates, details } = checkForDuplicates(testString2, content2);

    // ===== Results =====
    console.log('\n========================================');
    console.log('Test Results');
    console.log('========================================');

    if (hasDuplicates) {
      console.log('\n❌ DUPLICATE INPUT DETECTED!');
      details.forEach(d => console.log(`   - ${d}`));
    } else {
      console.log('\n✅ No duplicate input detected');
    }

    // Show terminal logs
    const terminalLogs = consoleLogs.filter(l => l.includes('[Terminal:'));
    if (terminalLogs.length > 0) {
      console.log('\nTerminal debug logs:');
      terminalLogs.slice(-30).forEach(l => console.log(`  ${l}`));
    }

    // Count unique terminal instances
    const instanceIds = new Set<string>();
    terminalLogs.forEach(l => {
      const match = l.match(/\[Terminal:([a-z0-9]+)\]/);
      if (match) instanceIds.add(match[1]);
    });
    console.log(`\nUnique terminal instances seen: ${instanceIds.size}`);
    console.log(`Instance IDs: ${[...instanceIds].join(', ')}`);

    // Write results
    const results = {
      timestamp: new Date().toISOString(),
      hasDuplicates,
      details,
      terminalInstances: [...instanceIds],
      consoleLogs: consoleLogs.slice(-100),
    };
    writeFileSync(join(config.outputDir, 'results.json'), JSON.stringify(results, null, 2));

    console.log(`\nScreenshots and results saved to: ${config.outputDir}`);

  } catch (error) {
    console.error('Test error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// CLI entry point
runRefreshDuplicateTest().catch(console.error);

export { runRefreshDuplicateTest, TestConfig };
