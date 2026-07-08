// index.ts — App entry point, lifecycle, and orchestration.

import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor } from 'electron';
import os from 'os';
import path from 'path';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { MultiWindowCoordinator } from './MultiWindowCoordinator.js';
import { WindowManager, markQuitting } from './WindowManager.js';
import { TrayManager } from './TrayManager.js';
import { registerIpcHandlers } from './ipc.js';
import { getAppRoot } from './paths.js';
import { registerSocketBridgeIpc, socketBridgeManager } from './SocketBridge.js';

// Set app name early — controls Dock tooltip, menu labels, and About panel
app.name = 'terminar';

// Graceful shutdown on SIGTERM/SIGINT. SIGTERM is sent by vite-plugin-electron
// during HMR; SIGINT by Ctrl+C. The log line captures who/when/where so we
// can diagnose unexpected SIGTERMs (e.g. spontaneous teardown while idle).
const handleSignal = (sig: 'SIGTERM' | 'SIGINT'): void => {
  const mu = process.memoryUsage();
  const fmt = (n: number) => Math.round(n / (1024 * 1024));
  const stack = (new Error().stack ?? '')
    .split('\n')
    .slice(1, 6)
    .map((s) => s.trim())
    .join(' | ');
  console.error('[signal]', {
    sig,
    ts: new Date().toISOString(),
    pid: process.pid,
    ppid: process.ppid,
    uptime_s: Math.round(process.uptime()),
    rss_mb: fmt(mu.rss),
    heapUsed_mb: fmt(mu.heapUsed),
    ready: app.isReady(),
    stack,
  });
  markQuitting();
  app.quit();
};
process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));
// Also flip the quit flag on the canonical Electron quit path (tray menu
// Quit, app.quit() from anywhere else) so the renderer-crash handler
// suppresses recovery during normal shutdown too.
app.on('before-quit', () => markQuitting());
// Electron doesn't close `net.Socket`s automatically on quit — disconnect
// every per-window Unix-socket bridge so fds don't leak past process exit.
app.on('before-quit', () => socketBridgeManager.destroyAll());

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
  const healthPoller = new HealthPoller();
  windowManager = new WindowManager();
  // Local non-null handle so TypeScript + closures below can use `wm` safely.
  const wm = windowManager;

  // Create the tray (builds initial menu internally)
  const trayManager = new TrayManager(
    configStore,
    healthPoller,
    wm,
    { serverPort },
  );

  // Register IPC handlers for renderer processes
  registerIpcHandlers(
    configStore,
    healthPoller,
    wm,
  );
  registerSocketBridgeIpc();

  // Wire health updates to menu rebuild
  healthPoller.setCallback(() => {
    trayManager.updateMenu();
  });

  // Start health polling. The server is Unix-socket-only (no HTTP /health
  // endpoint to poll) — check PID liveness instead, reading the same PID
  // file server-manager.js writes.
  healthPoller.startPidLiveness(path.join(os.homedir(), '.terminar', 'server.pid'));

  // Main-process memory + state telemetry.
  // Logs one [mem] line every 60s so multi-day leaks are visible from stdout.
  // Cheap: ~1 console.log/min, no dependencies. Keep default-on.
  const memTimer = setInterval(() => {
    const mu = process.memoryUsage();
    const fmt = (n: number) => Math.round(n / (1024 * 1024));
    console.log('[mem]', {
      rss_mb: fmt(mu.rss),
      heapUsed_mb: fmt(mu.heapUsed),
      heapTotal_mb: fmt(mu.heapTotal),
      external_mb: fmt(mu.external),
      arrayBuffers_mb: fmt(mu.arrayBuffers),
      windows: BrowserWindow.getAllWindows().length,
      tracked_windows: wm.windowCount(),
      ipc_events: ipcMain.eventNames().length,
    });
  }, 60_000);
  app.on('before-quit', () => clearInterval(memTimer));

  // Multi-window coordination (tab-per-window model)
  const multiWindow = new MultiWindowCoordinator();
  multiWindow.setupIpc();

  // Cmd+N / Ctrl+N: open a new terminal window with the next available tab.
  // Registered as a menu accelerator in WindowManager.setupTerminalMenu() so it
  // only fires when the Electron app is focused (not system-wide).
  wm.onNewWindow = async () => {
    const primaryWin = wm.getWindow('terminal');
    if (!primaryWin || primaryWin.isDestroyed()) {
      wm.openTerminal();
      return;
    }

    try {
      const allTabIds: string[] = await primaryWin.webContents.executeJavaScript(
        'window.__terminar?.getTabIds?.() ?? []',
      );

      const nextTab = multiWindow.getNextAvailableTab(allTabIds);

      if (!nextTab) {
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
  };

  // Broadcast screen-unlock / resume to all renderers so they can
  // refresh terminals.  macOS does NOT fire document.visibilitychange
  // during lock-screen, so the renderer's existing visibility handler
  // never triggers recovery.
  const broadcastScreenUnlocked = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('power:screen-unlocked');
    }
  };
  powerMonitor.on('unlock-screen', broadcastScreenUnlocked);
  powerMonitor.on('resume', broadcastScreenUnlocked);
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
