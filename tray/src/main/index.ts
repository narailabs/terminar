// index.ts — App entry point, lifecycle, and orchestration.

import { app, BrowserWindow, globalShortcut, nativeImage } from 'electron';
import path from 'path';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { MultiWindowCoordinator } from './MultiWindowCoordinator.js';
import { WindowManager } from './WindowManager.js';
import { TrayManager } from './TrayManager.js';
import { registerIpcHandlers } from './ipc.js';
import { getAppRoot } from './paths.js';

// Set app name early — controls Dock tooltip, menu labels, and About panel
app.name = 'terminar';

// Graceful shutdown on SIGTERM (sent by vite-plugin-electron during HMR).
// Without this, the process dies immediately and orphans Chromium child
// processes (GPU, network service), which produce cascading crash errors.
process.on('SIGTERM', () => app.quit());

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
  // Set custom Dock icon on macOS (needed for dev mode; prod uses electron-builder icon)
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(
      path.join(getAppRoot(), 'icons', 'icon.png'),
    );
    if (!dockIcon.isEmpty()) {
      app.dock?.setIcon(dockIcon);
    }
    // Hide from Dock — this is a tray-only app (shown when windows open)
    app.dock?.hide();
  }

  // Detect CLI launch mode
  const launchedByCli = process.env.TERMINAR_LAUNCHED_BY_CLI === '1';
  const serverPort = launchedByCli
    ? parseInt(process.env.TERMINAR_SERVER_PORT || '6750', 10)
    : undefined;

  // Create core instances
  const configStore = new ConfigStore();
  const config = configStore.load();
  const healthPoller = new HealthPoller();
  windowManager = new WindowManager();

  // Create the tray (builds initial menu internally)
  const trayManager = new TrayManager(
    configStore,
    healthPoller,
    windowManager,
    { serverPort },
  );

  // Register IPC handlers for renderer processes
  registerIpcHandlers(
    configStore,
    healthPoller,
    windowManager,
  );

  // Wire health updates to menu rebuild
  healthPoller.setCallback(() => {
    trayManager.updateMenu();
  });

  // Start health polling
  healthPoller.start(serverPort ?? config.server_port);

  // Multi-window coordination (tab-per-window model)
  const multiWindow = new MultiWindowCoordinator();
  multiWindow.setupIpc();

  // Cmd+N / Ctrl+N: open a new terminal window with the next available tab.
  // Capture a local const so TypeScript knows it's non-null inside the callback.
  const wm = windowManager;
  globalShortcut.register('CommandOrControl+N', async () => {
    // Find the primary terminal window to query tab state from the renderer
    const primaryWin = wm.getWindow('terminal');
    if (!primaryWin || primaryWin.isDestroyed()) {
      // No primary window — just open one
      wm.openTerminal();
      return;
    }

    try {
      const allTabIds: string[] = await primaryWin.webContents.executeJavaScript(
        'window.__terminar?.getTabIds?.() ?? []',
      );

      const nextTab = multiWindow.getNextAvailableTab(allTabIds);

      if (!nextTab) {
        // All tabs are shown — create a new tab in the renderer, then open a window for it
        const newTabId: string = await primaryWin.webContents.executeJavaScript(
          'window.__terminar?.createTab?.() ?? ""',
        );
        if (newTabId) {
          const win = wm.openTerminal(newTabId);
          multiWindow.register(win, newTabId);
        }
      } else {
        const win = wm.openTerminal(nextTab);
        multiWindow.register(win, nextTab);
      }
    } catch (err) {
      console.error('[multi-window] Failed to open new window:', err);
    }
  });
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
