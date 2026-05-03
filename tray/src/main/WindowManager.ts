// WindowManager.ts — Port of window creation from tray/src-tauri/src/lib.rs
// Manages named BrowserWindows for the tray app (install wizard, settings, terminal).

import { BrowserWindow, Menu, app, nativeImage, session, shell } from 'electron';
import path from 'path';
import { getAppRoot } from './paths.js';

const RETRYABLE_ERRORS = new Set([
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_EMPTY_RESPONSE',
]);

/** Load the custom terminar dock icon. */
function getDockIcon(): Electron.NativeImage {
  const iconPath = path.join(getAppRoot(), 'icons', 'icon.png');
  return nativeImage.createFromPath(iconPath);
}

/** Show the macOS Dock icon with the custom terminar icon. */
function showDockWithIcon(): void {
  if (process.platform !== 'darwin') return;
  const icon = getDockIcon();
  // Set icon before showing to avoid the default Electron icon flash
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon);
  }
  app.dock?.show();
  // Re-set after show — macOS can reset the icon during show()
  if (!icon.isEmpty()) {
    setTimeout(() => app.dock?.setIcon(icon), 100);
  }
}

export class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map();
  onNewWindow: (() => void) | null = null;

  constructor() {
    this.setupContentSecurityPolicy();
  }

  /** Set Content Security Policy headers for all renderer windows. */
  private setupContentSecurityPolicy(): void {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // Terminal pages need WebSocket access to the terminar server
      const isTerminalPage =
        details.url.includes('terminal.html') ||
        details.url.includes('/src/renderer/terminal.ts');

      const csp = isTerminalPage
        ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:* https://localhost:*; font-src 'self' data:"
        : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });
  }

  /** Get an existing window by label, or null if it doesn't exist / is destroyed. */
  getWindow(label: string): BrowserWindow | null {
    const win = this.windows.get(label);
    if (win && !win.isDestroyed()) {
      return win;
    }
    this.windows.delete(label);
    return null;
  }

  /** Open the Settings window. */
  openSettings(): void {
    const existing = this.getWindow('settings');
    if (existing) {
      existing.show();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 500,
      height: 550,
      title: 'terminar Settings',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.registerWindow('settings', win);
    this.openExternalLinks(win);
    this.loadUrl(win, 'settings');
  }

  /**
   * Open a terminal desktop app window.
   *
   * Without a tabId, behaves like the original single-window mode: reuses the
   * existing terminal window if one is open. With a tabId, always creates a new
   * window and passes the tab as a query parameter so the renderer knows which
   * tab to display.
   *
   * Returns the BrowserWindow so callers (e.g. MultiWindowCoordinator) can
   * register it for cross-window coordination.
   */
  openTerminal(tabId?: string): BrowserWindow {
    // Without a tabId, preserve single-window behaviour: reuse existing window
    if (!tabId) {
      const existing = this.getWindow('terminal');
      if (existing) {
        existing.show();
        existing.focus();
        return existing;
      }
    }

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'terminar',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 12 },
      webPreferences: {
        preload: this.terminalPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Use a unique label so multiple terminal windows can coexist
    const label = tabId ? `terminal-${Date.now()}` : 'terminal';
    this.registerWindow(label, win);
    this.openExternalLinks(win);
    this.loadTerminalUrl(win, tabId);
    this.setupTerminalMenu(win);

    return win;
  }

  /**
   * Close a window by its webContents id.
   * Used by the IPC handler when the renderer requests to close itself.
   * Searches both tracked windows and all BrowserWindows as fallback.
   */
  closeWindowById(webContentsId: number): void {
    // First check tracked windows
    for (const [, win] of this.windows.entries()) {
      if (!win.isDestroyed() && win.webContents.id === webContentsId) {
        win.close();
        return;
      }
    }

    // Fallback: search all BrowserWindows (handles windows not created by WindowManager)
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents.id === webContentsId) {
        win.close();
        return;
      }
    }
  }

  /** Check if any windows are open. */
  hasOpenWindows(): boolean {
    for (const [, win] of this.windows) {
      if (!win.isDestroyed()) return true;
    }
    return false;
  }

  /** Number of tracked (not yet destroyed) windows — used by main-process telemetry. */
  windowCount(): number {
    let count = 0;
    for (const [, win] of this.windows) {
      if (!win.isDestroyed()) count++;
    }
    return count;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /** Preload script path for tray windows (install, settings). */
  private preloadPath(): string {
    return path.join(getAppRoot(), 'dist-electron', 'preload.js');
  }

  /** Preload script path for the terminal window. */
  private terminalPreloadPath(): string {
    return path.join(getAppRoot(), 'dist-electron', 'terminal.js');
  }

  /** Open http/https links in the system browser instead of inside Electron. */
  private openExternalLinks(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  }

  private registerWindow(label: string, win: BrowserWindow): void {
    this.windows.set(label, win);

    // macOS: show Dock icon when a window is open
    if (process.platform === 'darwin') {
      showDockWithIcon();
    }

    win.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return;
      console.error(`[window] Renderer crashed (${label}): ${details.reason}`);
      if (!win.isDestroyed()) {
        win.webContents.reload();
      }
    });

    win.on('closed', () => {
      this.windows.delete(label);

      // macOS: hide Dock icon when all windows are closed
      if (process.platform === 'darwin' && !this.hasOpenWindows()) {
        app.dock?.hide();
      }
    });
  }

  /**
   * Attach a did-fail-load listener that retries transient network errors
   * with exponential backoff. Only active in dev mode when loading from
   * the Vite dev server, which may not be ready yet.
   */
  private attachDevRetry(
    win: BrowserWindow,
    url: string,
    maxRetries = 5,
  ): void {
    let attempt = 0;

    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return;
      if (!RETRYABLE_ERRORS.has(errorDescription)) return;

      attempt++;
      if (attempt > maxRetries) {
        console.error(
          `[window] Failed to load ${url} after ${maxRetries} retries (last: ${errorDescription}, code: ${errorCode})`,
        );
        return;
      }

      const delay = 500 * Math.pow(2, attempt - 1); // 500, 1000, 2000, 4000, 8000
      console.log(
        `[window] Retry ${attempt}/${maxRetries} for ${url} in ${delay}ms (${errorDescription})`,
      );
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.loadURL(url).catch(() => {});
        }
      }, delay);
    };

    win.webContents.on('did-fail-load', onFailLoad);

    // Clean up listener once the page loads successfully (prevents stacking on HMR)
    win.webContents.once('did-finish-load', () => {
      win.webContents.removeListener('did-fail-load', onFailLoad);
    });
  }

  /** Load a tray renderer page (install or settings). */
  private loadUrl(win: BrowserWindow, mode: string): void {
    // Dev mode: load from Vite dev server; Prod: load from file
    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

    if (VITE_DEV_SERVER_URL) {
      const url = `${VITE_DEV_SERVER_URL}?mode=${mode}`;
      this.attachDevRetry(win, url);
      win.loadURL(url).catch(() => {});
    } else {
      // Production: load from built files at tray/dist/index.html
      const indexPath = path.join(getAppRoot(), 'dist', 'index.html');
      void win.loadFile(indexPath, { search: `mode=${mode}` });
    }
  }

  /** Load the terminal page (web frontend), optionally targeting a specific tab. */
  private loadTerminalUrl(win: BrowserWindow, tabId?: string): void {
    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
    const tabQuery = tabId ? `?tab=${encodeURIComponent(tabId)}` : '';

    if (VITE_DEV_SERVER_URL) {
      const url = `${VITE_DEV_SERVER_URL}/terminal.html${tabQuery}`;
      this.attachDevRetry(win, url);
      win.loadURL(url).catch(() => {});
    } else {
      const terminalPath = path.join(getAppRoot(), 'dist', 'terminal.html');
      if (tabId) {
        void win.loadFile(terminalPath, { search: `tab=${encodeURIComponent(tabId)}` });
      } else {
        void win.loadFile(terminalPath);
      }
    }
  }

  /** Set Edit/View application menu when terminal window is focused. */
  private setupTerminalMenu(win: BrowserWindow): void {
    const isMac = process.platform === 'darwin';

    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: 'terminar',
              submenu: [
                { role: 'about' as const, label: 'About terminar' },
                { type: 'separator' as const },
                { role: 'hide' as const, label: 'Hide terminar' },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const, label: 'Quit terminar' },
              ],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [
          {
            label: 'New Window',
            accelerator: 'CommandOrControl+N',
            click: () => this.onNewWindow?.(),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'copy' },
          { role: 'paste' },
          { type: 'separator' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
    ];

    const terminalMenu = Menu.buildFromTemplate(template);

    win.on('focus', () => {
      Menu.setApplicationMenu(terminalMenu);
    });

    win.on('blur', () => {
      Menu.setApplicationMenu(null);
    });

    // Set menu immediately if already focused
    if (win.isFocused()) {
      Menu.setApplicationMenu(terminalMenu);
    }

    win.on('closed', () => {
      Menu.setApplicationMenu(null);
    });
  }
}
