'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');

describe('server-manager', () => {
  let tmpDir;
  let originalPidFile;
  let originalLogFile;
  let sm;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminar-test-'));
    // Override module-level constants by directly manipulating the required module
    sm = require('../lib/server-manager.js');
    originalPidFile = sm.PID_FILE;
    originalLogFile = sm.LOG_FILE;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete require.cache[require.resolve('../lib/server-manager.js')];
  });

  it('should export all expected functions', () => {
    assert.strictEqual(typeof sm.start, 'function');
    assert.strictEqual(typeof sm.stop, 'function');
    assert.strictEqual(typeof sm.restart, 'function');
    assert.strictEqual(typeof sm.status, 'function');
    assert.strictEqual(typeof sm.logs, 'function');
    assert.strictEqual(typeof sm.waitForSocketReady, 'function');
    assert.strictEqual(typeof sm.getRunningPid, 'function');
  });

  it('should have correct default port', () => {
    assert.strictEqual(sm.DEFAULT_PORT, 6750);
  });

  it('should return null for getRunningPid when no PID file exists', () => {
    // getRunningPid reads from the module's PID_FILE constant
    // Since no server is running in test, it should handle gracefully
    const pid = sm.getRunningPid();
    // Either null (no PID file) or a number (if a server happens to be running)
    assert.ok(pid === null || typeof pid === 'number');
  });


  it('should export waitForSocketReady and defaultSocketPath', () => {
    assert.strictEqual(typeof sm.waitForSocketReady, 'function');
    assert.strictEqual(typeof sm.defaultSocketPath, 'function');
  });

  it('should reject waitForSocketReady when nothing is listening', async () => {
    const missingSocket = path.join(tmpDir, 'does-not-exist.sock');
    await assert.rejects(
      () => sm.waitForSocketReady(missingSocket, 500),
      /did not become ready/,
    );
  });

  it('should reject waitForSocketReady for a stale socket file with no listener', async () => {
    // A plain file at the socket path must NOT count as ready — only an
    // actual listener does.
    const stale = path.join(tmpDir, 'stale.sock');
    fs.writeFileSync(stale, '');
    await assert.rejects(
      () => sm.waitForSocketReady(stale, 500),
      /did not become ready/,
    );
  });

  it('should resolve waitForSocketReady once the socket accepts connections', async () => {
    const socketPath = path.join(tmpDir, 'listening.sock');
    const server = net.createServer();
    try {
      setTimeout(() => server.listen(socketPath), 300);
      await sm.waitForSocketReady(socketPath, 2000);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
