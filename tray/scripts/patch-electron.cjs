// Dev postinstall: patch tray/node_modules/electron/dist/Electron.app so the
// local dev build shows "terminar" in the menu bar and uses the custom icon.
// Bundle-name patching + re-signing live in the shared module; icon copy is
// dev-specific (prod uses Electron's default icon until we ship a real .app).

'use strict';

const fs = require('fs');
const path = require('path');

const {
  resolveElectronAppPath,
  patchBundleName,
  verifyPatch,
} = require('../../npm/terminar/lib/patch-electron.js');

if (process.platform !== 'darwin') process.exit(0);

const electronApp = resolveElectronAppPath(__dirname);
if (!electronApp) {
  // Electron not installed yet (e.g. CI with --ignore-scripts)
  process.exit(0);
}

// 1. Replace default icon with the tray's custom icon (dev-only step).
const customIcon = path.join(__dirname, '..', 'icons', 'icon.icns');
const bundledIcon = path.join(electronApp, 'Contents', 'Resources', 'electron.icns');
try {
  fs.copyFileSync(customIcon, bundledIcon);
} catch {
  // Icon file may not exist yet — non-fatal
}

// 2. Patch CFBundleName / CFBundleDisplayName and re-sign.
try {
  patchBundleName(electronApp, { verbose: true });
  if (!verifyPatch(electronApp)) {
    console.warn('[tray postinstall] Info.plist patch did not take effect.');
  }
} catch (err) {
  console.warn(`[tray postinstall] Menu-bar patch failed: ${err.message}`);
}
