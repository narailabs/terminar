// index.ts — App entry point, lifecycle, and orchestration.
// Port of tray/src-tauri/src/lib.rs:run().

import { app, BrowserWindow } from 'electron';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { ServiceManager } from './ServiceManager.js';
import { WindowManager } from './WindowManager.js';
import { TrayManager } from './TrayManager.js';
import { registerIpcHandlers } from './ipc.js';

// ------------------------------------------------------------------
// Single instance lock
// ------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Shared reference for lifecycle handlers
let windowManager: WindowManager | null = null;

// ------------------------------------------------------------------
// App ready — main setup
// ------------------------------------------------------------------
void app.whenReady().then(() => {
  // Hide from Dock on macOS — this is a tray-only app
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  // Create core instances
  const configStore = new ConfigStore();
  const config = configStore.load();
  const serviceManager = new ServiceManager();
  const healthPoller = new HealthPoller();
  windowManager = new WindowManager();

  // Create the tray (builds initial menu internally)
  const trayManager = new TrayManager(
    configStore,
    serviceManager,
    healthPoller,
    windowManager,
  );

  // Register IPC handlers for renderer processes
  registerIpcHandlers(
    configStore,
    serviceManager,
    healthPoller,
    windowManager,
  );

  // Wire health updates to menu rebuild
  healthPoller.setCallback(() => {
    trayManager.updateMenu();
  });

  // Start health polling
  healthPoller.start(config.gateway_port);

  // Show install wizard if the service is not installed
  if (serviceManager.status() === 'notinstalled') {
    windowManager.openInstall();
  }
});

// ------------------------------------------------------------------
// Keep app running when all windows close (tray stays alive)
// ------------------------------------------------------------------
app.on('window-all-closed', () => {
  // Don't quit — the tray icon stays alive
  // macOS: hide Dock icon when no windows are open
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }
});

// ------------------------------------------------------------------
// macOS: reopen terminal when Dock icon is clicked with no windows
// ------------------------------------------------------------------
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
    windowManager.openTerminal();
  }
});

// ------------------------------------------------------------------
// Second instance — focus an existing window if one is open
// ------------------------------------------------------------------
app.on('second-instance', () => {
  // If a window is already open, focus it
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const win = windows[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
