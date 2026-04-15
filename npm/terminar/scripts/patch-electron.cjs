// Postinstall: patch the npm-installed Electron.app so macOS shows "terminar"
// in the menu bar instead of "Electron". Failures here are non-fatal — the
// runtime launcher (lib/app-launcher.js) re-runs the patch on first launch if
// needed, so a user's npm install never fails because of this step.

'use strict';

if (process.platform !== 'darwin') process.exit(0);

const {
  resolveElectronAppPath,
  patchBundleName,
  verifyPatch,
} = require('../lib/patch-electron.js');

const electronApp = resolveElectronAppPath(__dirname);
if (!electronApp) {
  console.warn(
    '[terminar postinstall] Electron.app not found; skipping menu-bar patch. ' +
    'The launcher will retry on first run.',
  );
  process.exit(0);
}

try {
  patchBundleName(electronApp, { verbose: true });
  if (!verifyPatch(electronApp)) {
    console.warn(
      '[terminar postinstall] Info.plist patch did not take effect; ' +
      'launcher will retry on first run.',
    );
  }
} catch (err) {
  console.warn(
    `[terminar postinstall] Menu-bar patch failed: ${err.message}. ` +
    'Launcher will retry on first run.',
  );
}
