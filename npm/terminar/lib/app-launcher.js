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

function launch(serverBinaryPath, port) {
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
    },
  });

  child.unref();
  return child.pid;
}

module.exports = { launch, getElectronPath, getAppEntry };
