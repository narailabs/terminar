'use strict';

const path = require('path');
const fs = require('fs');

const PLATFORM_PACKAGES = {
  'darwin-arm64': '@narai/terminar-darwin-arm64',
  'darwin-x64': '@narai/terminar-darwin-x64',
  'linux-x64': '@narai/terminar-linux-x64',
  'linux-arm64': '@narai/terminar-linux-arm64',
  'win32-x64': '@narai/terminar-win32-x64',
};

function getServerBinaryPath() {
  const platform = process.platform;
  const arch = process.arch;
  const key = `${platform}-${arch}`;
  const pkg = PLATFORM_PACKAGES[key];

  if (!pkg) {
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
  }

  const binaryName = platform === 'win32' ? 'terminar-server.exe' : 'terminar-server';

  // Try to resolve from the platform package
  try {
    const pkgDir = path.dirname(require.resolve(`${pkg}/package.json`));
    const binaryPath = path.join(pkgDir, 'bin', binaryName);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {
    // Package not installed
  }

  // Fallback: try to find in PATH
  const { execFileSync } = require('child_process');
  try {
    const cmd = platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(cmd, ['terminar-server'], { encoding: 'utf-8' }).trim();
    if (result) {
      return result.split('\n')[0];
    }
  } catch {
    // Not in PATH
  }

  throw new Error(
    `terminar-server binary not found. Platform package ${pkg} may not be installed.\n` +
    'Try: npm install -g terminar (which includes the correct platform package)'
  );
}

module.exports = { getServerBinaryPath, PLATFORM_PACKAGES };
