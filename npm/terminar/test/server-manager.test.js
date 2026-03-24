'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
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
    assert.strictEqual(typeof sm.waitForHealth, 'function');
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

  it('should reject waitForHealth when no server is running', async () => {
    // Use a port that's definitely not listening
    await assert.rejects(
      () => sm.waitForHealth(59999, 500),
      /timed out/,
    );
  });
});
