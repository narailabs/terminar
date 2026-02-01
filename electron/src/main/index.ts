import { app, BrowserWindow } from 'electron';
import path from 'path';
import { ServerManager } from './ServerManager.js';
import { AutoUpdater } from './AutoUpdater.js';

// Global server manager instance
export const serverManager = new ServerManager();

// Auto-updater (checks for updates on launch)
export const autoUpdater = new AutoUpdater();

/**
 * Creates the main application window with secure defaults.
 */
export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the renderer's index.html
  const indexPath = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(indexPath);
}

// Single instance lock: only one instance of the app should run
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the existing window when a second instance is attempted
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      if (windows[0].isMinimized()) windows[0].restore();
      windows[0].focus();
    }
  });
}

// Wait for the app to be ready before creating the window
app.whenReady().then(async () => {
  // Start the embedded server
  try {
    await serverManager.start();
    console.log('[Electron] Server started on port', serverManager.getPort());
  } catch (err) {
    console.error('[Electron] Failed to start server:', err);
  }

  createWindow();

  // Check for updates (non-blocking)
  autoUpdater.checkForUpdates();
});

// Graceful shutdown: stop server before quitting
app.on('before-quit', () => {
  serverManager.stop();
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create a window when the dock icon is clicked and no windows are open
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
