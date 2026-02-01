/**
 * TUI Rendering Test for Claude Code Config Menu
 *
 * This script tests TUI rendering by:
 * 1. Launching Claude Code in a terminal
 * 2. Opening the /config menu
 * 3. Cycling through tabs with arrow keys
 * 4. Capturing screenshots to detect rendering issues
 *
 * Usage:
 *   pnpm tui-test           # Run with headless browser
 *   HEADED=true pnpm tui-test  # Run with visible browser
 */

import { chromium, Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  outputDir: string;
  baseUrl: string;
  headed: boolean;
  claudeCodeCommand: string;
  configCycles: number;
}

interface TestResult {
  timestamp: string;
  config: TestConfig;
  screenshots: string[];
  tabCycleScreenshots: string[];
  errors: string[];
}

const DEFAULT_CONFIG: TestConfig = {
  outputDir: join(process.cwd(), '.tui-tests'),
  baseUrl: 'http://localhost:3001',
  headed: process.env.HEADED === 'true',
  claudeCodeCommand: 'claude',
  configCycles: 3, // Number of times to cycle through all tabs
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

async function dragSessionToPane(page: Page, preferZsh = true): Promise<boolean> {
  console.log('Looking for session to drag to pane...');

  // Get all terminal items in the sidebar
  const sessionItems = page.locator('.terminal-item');
  const count = await sessionItems.count();

  if (count === 0) {
    console.log('No sessions found in sidebar');
    return false;
  }

  console.log(`Found ${count} sessions in sidebar`);

  // Try to find a zsh session first (more likely to have proper PATH with Claude Code)
  let selectedItem = null;
  let selectedIndex = 0;

  for (let i = 0; i < count; i++) {
    const item = sessionItems.nth(i);
    const text = await item.textContent();
    console.log(`  Session ${i}: ${text}`);

    if (preferZsh && text && text.toLowerCase().includes('zsh')) {
      console.log(`  -> Selected zsh session at index ${i}`);
      selectedItem = item;
      selectedIndex = i;
      break;
    }
  }

  // If no zsh found, fail - we need zsh for Claude Code
  if (!selectedItem) {
    console.error('No zsh session found! Please create a zsh terminal session first.');
    return false;
  }

  const sessionBox = await selectedItem.boundingBox();
  if (!sessionBox) {
    console.log('Could not get session bounding box');
    return false;
  }

  // Find the target pane (empty pane or main pane)
  const pane = page.locator('.pane, .empty-pane').first();
  const paneBox = await pane.boundingBox();

  if (!paneBox) {
    console.log('No pane found');
    return false;
  }

  // Perform drag and drop
  await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2, { steps: 10 });
  await page.mouse.up();

  await page.waitForTimeout(1000);
  return true;
}

async function focusTerminal(page: Page): Promise<boolean> {
  console.log('Focusing terminal...');

  // Check if there's already a terminal visible
  const terminal = page.locator('.xterm-rows').first();
  if (await terminal.count() > 0) {
    await terminal.click();
    await page.waitForTimeout(200);
    return true;
  }

  // If no terminal, we need to drag a session to the pane first
  console.log('No terminal visible, dragging session to pane...');
  const dragged = await dragSessionToPane(page);
  if (!dragged) {
    console.warn('Could not drag session to pane');
    return false;
  }

  // Now try to focus the terminal again
  const terminalAfterDrag = page.locator('.xterm-rows').first();
  if (await terminalAfterDrag.count() > 0) {
    await terminalAfterDrag.click();
    await page.waitForTimeout(200);
    return true;
  }

  console.warn('Could not find terminal after drag');
  return false;
}

async function typeInTerminal(page: Page, text: string, delay = 50): Promise<void> {
  await page.keyboard.type(text, { delay });
}

async function pressKey(page: Page, key: string, count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
}

async function handleTrustPrompt(page: Page, timeout = 10000): Promise<boolean> {
  console.log('Checking for trust prompt...');
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const terminalContent = await page.locator('.xterm-rows').first().textContent({ timeout: 1000 });
      if (terminalContent) {
        // Check for trust prompt indicators
        if (terminalContent.includes('Do you trust') ||
            terminalContent.includes('trust the files') ||
            terminalContent.includes('Yes, proceed')) {
          console.log('Trust prompt detected, pressing 1 to accept...');
          await page.waitForTimeout(300);
          await page.keyboard.type('1', { delay: 50 });
          await page.waitForTimeout(200);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
          return true;
        }
        // If we see the main Claude Code prompt, no trust prompt needed
        if (terminalContent.includes('❯') || terminalContent.includes('What would you like')) {
          console.log('No trust prompt detected, Claude Code ready');
          return false;
        }
      }
    } catch {
      // Ignore timeout errors during polling
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function waitForClaudeCodeReady(page: Page, timeout = 30000): Promise<boolean> {
  console.log('Waiting for Claude Code to be ready...');
  const startTime = Date.now();

  // Look for Claude Code specific indicators (the welcome screen or prompt)
  const readyIndicators = [
    'Claude Code', // Welcome message
    'Welcome', // Welcome screen
    '❯', // Claude Code prompt character
    '/help', // Help hint
    'What would you like to do', // Initial prompt
  ];

  // First check for and handle trust prompt
  await handleTrustPrompt(page, 15000);

  while (Date.now() - startTime < timeout) {
    // Check terminal content for ready indicators
    try {
      const terminalContent = await page.locator('.xterm-rows').first().textContent({ timeout: 1000 });
      if (terminalContent) {
        // Check again for trust prompt (might appear after initial load)
        if (terminalContent.includes('Do you trust') || terminalContent.includes('trust the files')) {
          console.log('Trust prompt appeared, handling...');
          await handleTrustPrompt(page, 5000);
          continue;
        }

        for (const indicator of readyIndicators) {
          if (terminalContent.includes(indicator)) {
            console.log(`Claude Code ready (found: "${indicator}")`);
            await page.waitForTimeout(500);
            return true;
          }
        }
        // Debug: show what we see
        if (Date.now() - startTime > 5000 && (Date.now() - startTime) % 5000 < 600) {
          console.log(`  Current terminal content (first 200 chars): ${terminalContent.slice(0, 200).replace(/\n/g, '\\n')}`);
        }
      }
    } catch {
      // Ignore timeout errors during polling
    }
    await page.waitForTimeout(500);
  }

  console.warn('Timeout waiting for Claude Code ready state');
  return false;
}

async function clearTerminalLine(page: Page): Promise<void> {
  console.log('Clearing terminal line...');
  // Send Ctrl+C to cancel any running command
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(200);
  // Send Ctrl+U to clear the current line
  await page.keyboard.press('Control+u');
  await page.waitForTimeout(200);
}

async function waitForShellPrompt(page: Page, timeout = 5000): Promise<boolean> {
  console.log('Waiting for shell prompt...');
  const startTime = Date.now();
  const promptIndicators = ['$', '%', '❯', '>'];

  while (Date.now() - startTime < timeout) {
    try {
      const content = await page.locator('.xterm-rows').first().textContent({ timeout: 500 });
      if (content) {
        // Check if the last non-empty line ends with a prompt character
        const lines = content.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1].trim();
          for (const prompt of promptIndicators) {
            if (lastLine.endsWith(prompt) || lastLine.endsWith(prompt + ' ')) {
              console.log(`Found shell prompt: "${lastLine.slice(-20)}"`);
              return true;
            }
          }
        }
      }
    } catch {
      // Ignore
    }
    await page.waitForTimeout(200);
  }
  return false;
}

async function exitClaudeCodeIfRunning(page: Page): Promise<void> {
  console.log('Checking if Claude Code is already running...');
  const content = await page.locator('.xterm-rows').first().textContent({ timeout: 1000 }).catch(() => '');

  // Check for Claude Code indicators
  if (content && (content.includes('❯') || content.includes('Claude Code') || content.includes('/help'))) {
    console.log('Claude Code detected, sending /exit...');
    await typeInTerminal(page, '/exit');
    await pressKey(page, 'Enter');
    await page.waitForTimeout(2000);
  }

  // Send Ctrl+C a few times to ensure we're at a clean prompt
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
  }

  // Clear the screen with Ctrl+L
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(500);
}

async function startClaudeCode(page: Page, config: TestConfig): Promise<boolean> {
  console.log('Starting Claude Code...');

  // Exit any existing Claude Code session first
  await exitClaudeCodeIfRunning(page);

  // First, clear any existing content on the line
  await clearTerminalLine(page);

  // Wait for a clean shell prompt
  const hasPrompt = await waitForShellPrompt(page);
  if (!hasPrompt) {
    console.warn('Could not detect shell prompt');
  }

  // Type the claude command
  await typeInTerminal(page, config.claudeCodeCommand);
  await pressKey(page, 'Enter');

  // Wait for Claude Code to initialize
  await page.waitForTimeout(3000);

  const ready = await waitForClaudeCodeReady(page);

  if (!ready) {
    console.error('Claude Code did not start - stopping test');
    return false;
  }

  return true;
}

async function openConfigMenu(page: Page): Promise<boolean> {
  console.log('Opening /config menu...');

  await typeInTerminal(page, '/config');
  await pressKey(page, 'Enter');

  // Wait for config menu to render
  await page.waitForTimeout(1500);

  return true;
}

async function cycleConfigTabs(
  page: Page,
  config: TestConfig,
  result: TestResult
): Promise<void> {
  console.log(`Cycling through config tabs ${config.configCycles} times...`);

  // Config menu has tabs: Status, Config, Usage (3 tabs)
  const tabCount = 3;
  const totalPresses = tabCount * config.configCycles;

  // Capture initial state
  const initialPath = join(config.outputDir, 'config-initial.png');
  await page.screenshot({ path: initialPath });
  result.screenshots.push(initialPath);
  result.tabCycleScreenshots.push(initialPath);
  console.log('  Captured initial config state');

  // Cycle through tabs using right arrow
  for (let i = 0; i < totalPresses; i++) {
    const cycleNum = Math.floor(i / tabCount);
    const tabNum = i % tabCount;

    // Press right arrow to move to next tab
    await pressKey(page, 'ArrowRight');

    // Small delay to let TUI render
    await page.waitForTimeout(150);

    // Capture screenshot
    const filename = `config-cycle${cycleNum}-tab${tabNum + 1}.png`;
    const filepath = join(config.outputDir, filename);
    await page.screenshot({ path: filepath });

    result.screenshots.push(filepath);
    result.tabCycleScreenshots.push(filepath);

    console.log(`  Cycle ${cycleNum + 1}/${config.configCycles}, Tab ${tabNum + 1}/${tabCount}`);
  }

  // Also test wrapping with left arrow
  console.log('Testing left arrow wrap...');
  for (let i = 0; i < tabCount + 1; i++) {
    await pressKey(page, 'ArrowLeft');
    await page.waitForTimeout(150);

    const filename = `config-left-${i}.png`;
    const filepath = join(config.outputDir, filename);
    await page.screenshot({ path: filepath });
    result.screenshots.push(filepath);
  }
}

async function exitConfigMenu(page: Page): Promise<void> {
  console.log('Exiting config menu...');
  await pressKey(page, 'Escape');
  await page.waitForTimeout(500);
}

async function runTuiTest(config: TestConfig = DEFAULT_CONFIG): Promise<TestResult> {
  console.log('\n========================================');
  console.log('TUI Rendering Test - Claude Code Config');
  console.log('========================================\n');
  console.log(`Output directory: ${config.outputDir}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Headed mode: ${config.headed}`);
  console.log(`Config cycles: ${config.configCycles}`);
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
    tabCycleScreenshots: [],
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

    // Capture initial page state
    const debugPath = join(config.outputDir, 'debug-initial-page.png');
    await page.screenshot({ path: debugPath });
    result.screenshots.push(debugPath);

    // Wait for terminal
    await waitForTerminalReady(page);

    // Focus on terminal
    const focused = await focusTerminal(page);
    if (!focused) {
      result.errors.push('Could not focus terminal');
    }

    // Start Claude Code
    const claudeStarted = await startClaudeCode(page, config);
    if (!claudeStarted) {
      result.errors.push('Claude Code did not start properly - check that "claude" command is available');

      // Capture the failed state for debugging
      const failedPath = join(config.outputDir, 'claude-start-failed.png');
      await page.screenshot({ path: failedPath });
      result.screenshots.push(failedPath);

      console.log('\nTest stopped: Claude Code did not start.');
      console.log('Make sure you have a terminal session with Claude Code available.');
      console.log('You can also run Claude Code manually first, then run this test.\n');
      return result;
    }

    // Capture Claude Code initial state
    const claudePath = join(config.outputDir, 'claude-code-ready.png');
    await page.screenshot({ path: claudePath });
    result.screenshots.push(claudePath);

    // Open config menu
    await openConfigMenu(page);

    // Cycle through config tabs
    await cycleConfigTabs(page, config, result);

    // Exit config menu
    await exitConfigMenu(page);

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
  console.log(`Screenshots captured: ${result.screenshots.length}`);
  console.log(`Tab cycle screenshots: ${result.tabCycleScreenshots.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`\nResults saved to: ${config.outputDir}`);
  console.log(`Manifest: ${manifestPath}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  }

  console.log('\n--- Screenshot paths for Claude Code analysis ---');
  result.tabCycleScreenshots.slice(0, 5).forEach(p => console.log(p));
  if (result.tabCycleScreenshots.length > 5) {
    console.log(`... and ${result.tabCycleScreenshots.length - 5} more`);
  }

  return result;
}

// CLI entry point
runTuiTest().catch(console.error);

export { runTuiTest, TestConfig, TestResult };
