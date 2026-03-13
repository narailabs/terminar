// index.ts — App entry point, lifecycle, and orchestration.

import { app, BrowserWindow } from 'electron';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { ServerManager } from './ServerManager.js';
import { WindowManager } from './WindowManager.js';
import { TrayManager } from './TrayManager.js';
import { WslManager } from './WslManager.js';
import { SocketBridge } from './SocketBridge.js';
import { registerIpcHandlers } from './ipc.js';

// ------------------------------------------------------------------
// Single instance lock
// ------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// Shared references for lifecycle handlers
let windowManager: WindowManager | null = null;
let serverManager: ServerManager | null = null;
let socketBridge: SocketBridge | null = null;

// ------------------------------------------------------------------
// App ready — main setup
// ------------------------------------------------------------------
void app.whenReady().then(async () => {
  // Hide from Dock on macOS — this is a tray-only app
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  // Create core instances
  const configStore = new ConfigStore();
  serverManager = new ServerManager();
  const healthPoller = new HealthPoller();
  windowManager = new WindowManager();

  // Wire the health poller to the server manager
  healthPoller.setServerManager(serverManager);

  // Create the tray (builds initial menu internally)
  const trayManager = new TrayManager(
    serverManager,
    healthPoller,
    windowManager,
  );

  // Register IPC handlers for renderer processes
  registerIpcHandlers(
    configStore,
    serverManager,
    healthPoller,
    windowManager,
  );

  // Wire health updates to menu rebuild
  healthPoller.setCallback(() => {
    trayManager.updateMenu();
  });

  // Start health polling
  healthPoller.start();

  // On Windows, check WSL availability before starting server
  if (WslManager.isWindows()) {
    if (!WslManager.isWslInstalled() || !WslManager.hasDistro()) {
      windowManager.showWslGuide();
      return;
    }
  }

  // Start the server automatically
  try {
    await serverManager.start();
  } catch (e) {
    console.error(`Failed to start server on launch: ${e}`);
  }

  // Create the socket bridge for terminal window communication
  socketBridge = new SocketBridge(serverManager.getSocketPath());

  // Open the terminal window on launch
  windowManager.openTerminal();

  // Wire the socket bridge to the terminal window
  const terminalWin = windowManager.getWindow('terminal');
  if (terminalWin) {
    socketBridge.setWindow(terminalWin);
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

    // Re-wire socket bridge to the new terminal window
    const terminalWin = windowManager.getWindow('terminal');
    if (terminalWin && socketBridge) {
      socketBridge.setWindow(terminalWin);
    }
  }
});

// ------------------------------------------------------------------
// Second instance — focus an existing window if one is open
// ------------------------------------------------------------------
app.on('second-instance', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    const win = windows[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

// ------------------------------------------------------------------
// Clean shutdown — stop server and socket bridge on quit
// ------------------------------------------------------------------
app.on('before-quit', () => {
  if (socketBridge) {
    socketBridge.destroy();
  }
  if (serverManager) {
    void serverManager.stop();
  }
});
