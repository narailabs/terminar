'use strict';

const { spawn } = require('child_process');
const path = require('path');

function getElectronPath() {
  try {
    return require('electron');
  } catch {
    throw new Error(
      'Electron is not installed. Try: npm install -g terminar'
    );
  }
}

function getAppEntry() {
  return path.join(__dirname, '..', 'app', 'dist-electron', 'index.js');
}

// Self-heal the Electron.app Info.plist if postinstall didn't stick. macOS reads
// the menu-bar app name from CFBundleName, so without this users see "Electron".
// Runs at most once per Electron install (subsequent launches short-circuit on
// verifyPatch).
function ensurePatched() {
  if (process.platform !== 'darwin') return;
  let mod;
  try {
    mod = require('./patch-electron.js');
  } catch {
    return;
  }
  const electronApp = mod.resolveElectronAppPath(__dirname);
  if (!electronApp) return;
  if (mod.verifyPatch(electronApp)) return;
  try {
    mod.patchBundleName(electronApp);
  } catch (err) {
    console.error(
      `[terminar] Could not patch Electron menu-bar name: ${err.message}`,
    );
  }
}

function launch(serverBinaryPath, port, socketPath) {
  // Check for display on Linux
  if (process.platform === 'linux') {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      console.error(
        'No display server detected ($DISPLAY / $WAYLAND_DISPLAY not set).\n' +
        'Use "terminar server start" to run the server without a GUI.'
      );
      process.exit(1);
    }
  }

  ensurePatched();

  const electronPath = getElectronPath();
  const appEntry = getAppEntry();

  const child = spawn(electronPath, [appEntry], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      TERMINAR_LAUNCHED_BY_CLI: '1',
      TERMINAR_SERVER_BIN: serverBinaryPath,
      TERMINAR_SERVER_PORT: String(port),
      ...(socketPath ? { TERMINAR_SOCKET_PATH: socketPath } : {}),
    },
  });

  child.unref();
  return child.pid;
}

module.exports = { launch, getElectronPath, getAppEntry };
