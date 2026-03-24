'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('platform', () => {
  let originalPlatform;
  let originalArch;

  beforeEach(() => {
    originalPlatform = process.platform;
    originalArch = process.arch;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    Object.defineProperty(process, 'arch', { value: originalArch });
  });

  it('should export PLATFORM_PACKAGES with all 5 targets', () => {
    const { PLATFORM_PACKAGES } = require('../lib/platform.js');

    assert.ok(PLATFORM_PACKAGES['darwin-arm64']);
    assert.ok(PLATFORM_PACKAGES['darwin-x64']);
    assert.ok(PLATFORM_PACKAGES['linux-x64']);
    assert.ok(PLATFORM_PACKAGES['linux-arm64']);
    assert.ok(PLATFORM_PACKAGES['win32-x64']);
    assert.strictEqual(Object.keys(PLATFORM_PACKAGES).length, 5);
  });

  it('should map to correct @narai scoped package names', () => {
    const { PLATFORM_PACKAGES } = require('../lib/platform.js');

    assert.strictEqual(PLATFORM_PACKAGES['darwin-arm64'], '@narai/terminar-darwin-arm64');
    assert.strictEqual(PLATFORM_PACKAGES['win32-x64'], '@narai/terminar-win32-x64');
  });

  it('should throw for unsupported platform', () => {
    // Override platform to something unsupported
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    Object.defineProperty(process, 'arch', { value: 'x64' });

    // Re-require to get fresh module
    delete require.cache[require.resolve('../lib/platform.js')];
    const { getServerBinaryPath } = require('../lib/platform.js');

    assert.throws(() => getServerBinaryPath(), /Unsupported platform/);
  });
});
