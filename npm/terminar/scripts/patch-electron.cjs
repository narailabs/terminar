// Patch the npm-installed Electron.app bundle so macOS shows "terminar"
// in the menu bar instead of "Electron".

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);

const electronApp = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app',
);
const plist = path.join(electronApp, 'Contents', 'Info.plist');

if (!fs.existsSync(plist)) {
  // Electron not installed yet
  process.exit(0);
}

// Patch CFBundleName and CFBundleDisplayName
try {
  execSync(
    `plutil -replace CFBundleName -string terminar "${plist}" && ` +
    `plutil -replace CFBundleDisplayName -string terminar "${plist}"`,
  );
} catch {
  // Non-fatal — menu will just show "Electron"
  process.exit(0);
}

// Re-sign to restore valid ad-hoc signature
const sign = (target) => {
  try {
    execSync(`codesign --force --sign - "${target}"`, { stdio: 'ignore' });
  } catch {
    // Non-fatal
  }
};

const frameworks = path.join(electronApp, 'Contents', 'Frameworks');
const fwVersionA = path.join(
  frameworks, 'Electron Framework.framework', 'Versions', 'A',
);
if (fs.existsSync(fwVersionA)) sign(fwVersionA);

try {
  for (const entry of fs.readdirSync(frameworks)) {
    const full = path.join(frameworks, entry);
    if (entry.endsWith('.app') || entry.endsWith('.framework')) sign(full);
  }
} catch {
  // Ignore readdir errors
}

sign(electronApp);
