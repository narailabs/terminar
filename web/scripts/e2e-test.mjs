#!/usr/bin/env node
/**
 * End-to-end test for terminal functionality
 * Run: node scripts/e2e-test.mjs
 * Requires: Server running on ws://localhost:3000/ws
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3000/ws';
const TIMEOUT = 10000;

let ws;
let sessionId = null;
let testsPassed = 0;
let testsFailed = 0;

function log(msg) {
  console.log(`[E2E] ${msg}`);
}

function error(msg) {
  console.error(`[E2E ERROR] ${msg}`);
}

function send(message) {
  const json = JSON.stringify(message);
  log(`Sending: ${json}`);
  ws.send(json);
}

function waitForMessage(predicate, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for message'));
    }, timeoutMs);

    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        log(`Received: ${JSON.stringify(msg).substring(0, 100)}`);
        if (predicate(msg)) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

function waitForOutput(substring, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      log(`Timeout! Collected output so far: ${collectedOutput.substring(0, 200)}`);
      reject(new Error(`Timeout waiting for output containing: ${substring}`));
    }, timeoutMs);

    let collectedOutput = '';

    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Output' && typeof msg.data === 'string') {
          collectedOutput += msg.data;
          log(`Output chunk: ${msg.data.substring(0, 50).replace(/\n/g, '\\n')}...`);
          if (collectedOutput.includes(substring)) {
            clearTimeout(timeout);
            ws.off('message', handler);
            resolve(collectedOutput);
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    ws.on('message', handler);
  });
}

async function runTest(name, testFn) {
  try {
    log(`\n--- Running: ${name} ---`);
    await testFn();
    log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    error(`✗ ${name}: ${err.message}`);
    testsFailed++;
  }
}

async function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      log('WebSocket connected');
      resolve();
    });

    ws.on('error', (err) => {
      error(`WebSocket error: ${err.message}`);
      reject(err);
    });

    // Global message logger for debugging
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        log(`[GLOBAL] Message type: ${msg.type}, data length: ${msg.data?.length || 0}`);
      } catch (e) {
        log(`[GLOBAL] Non-JSON message: ${data.toString().substring(0, 50)}`);
      }
    });

    setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, TIMEOUT);
  });
}

async function main() {
  log('Starting E2E tests...');
  log(`Connecting to ${WS_URL}`);

  try {
    await connect();
  } catch (err) {
    error(`Failed to connect: ${err.message}`);
    error('Make sure the server is running: ./target/release/persistent-shell-server --no-auth');
    process.exit(1);
  }

  // Test 1: List sessions
  await runTest('should list sessions', async () => {
    send({ type: 'list_sessions' });
    // Server responds with "SessionList" (PascalCase for server messages)
    const msg = await waitForMessage((m) => m.type === 'SessionList');

    if (msg.type !== 'SessionList') {
      throw new Error(`Expected SessionList, got ${msg.type}`);
    }
    if (!Array.isArray(msg.sessions)) {
      throw new Error('Expected sessions array');
    }

    log(`Found ${msg.sessions.length} sessions`);

    // Store session if one exists
    if (msg.sessions.length > 0) {
      sessionId = msg.sessions[0].id;
      log(`Using existing session: ${sessionId}`);
    }
  });

  // Test 2: Create session if needed
  await runTest('should create session if needed', async () => {
    if (sessionId) {
      log('Reusing existing session');
      return;
    }

    send({
      type: 'create_session',
      cwd: '/',
      shell: '/bin/sh',
      env: {},
      cols: 80,
      rows: 24,
    });

    // Server responds with SessionList containing the new session
    const msg = await waitForMessage((m) => m.type === 'SessionList' && m.sessions?.length > 0);

    if (msg.type !== 'SessionList') {
      throw new Error(`Expected SessionList, got ${msg.type}`);
    }

    sessionId = msg.sessions[0].id;
    log(`Created session: ${sessionId}`);
  });

  // Test 3: Attach to session
  await runTest('should attach to session', async () => {
    if (!sessionId) {
      throw new Error('No session ID');
    }

    send({
      type: 'attach',
      session_id: sessionId,
      mode: 'rw',
    });

    // Server sends Output with history (may be empty)
    const msg = await waitForMessage((m) => m.type === 'Output' && m.session_id === sessionId);

    if (msg.type !== 'Output') {
      throw new Error(`Expected Output, got ${msg.type}`);
    }
    log(`Attached to session, received ${msg.data?.length || 0} bytes of history`);
  });

  // Wait a moment for shell to be ready
  await new Promise((r) => setTimeout(r, 1000));

  // Test 4: Execute ls -la command
  await runTest('should execute ls -la command and receive output', async () => {
    if (!sessionId) {
      throw new Error('No session ID');
    }

    log('Sending command: ls -la');
    send({
      type: 'input',
      session_id: sessionId,
      data: 'ls -la /\n',
    });

    // Wait for output containing typical ls -la patterns
    const output = await waitForOutput('total', 5000);

    log(`Received output (first 150 chars): ${output.substring(0, 150).replace(/\n/g, '\\n')}`);

    // Verify we got directory listing output
    if (!output.includes('total')) {
      throw new Error('Expected output to contain "total"');
    }
  });

  // Wait for ls to fully complete (wait for prompt)
  await new Promise((r) => setTimeout(r, 3000));

  // Test 5: Execute echo command
  await runTest('should execute echo command correctly', async () => {
    if (!sessionId) {
      throw new Error('No session ID');
    }

    const testString = 'E2E_TEST_' + Date.now();

    log(`Sending command: echo ${testString}`);
    send({
      type: 'input',
      session_id: sessionId,
      data: `echo ${testString}\n`,
    });

    const output = await waitForOutput(testString, 5000);

    if (!output.includes(testString)) {
      throw new Error(`Expected output to contain ${testString}`);
    }
    log('Echo output received correctly');
  });

  // Cleanup
  ws.close();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`E2E Tests Complete: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('='.repeat(50));

  process.exit(testsFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  error(`Unhandled error: ${err.message}`);
  process.exit(1);
});
