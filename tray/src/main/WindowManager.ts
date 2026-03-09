// WindowManager.ts — Port of window creation from tray/src-tauri/src/lib.rs
// Manages named BrowserWindows for the tray app (install wizard, settings, terminal).

import { BrowserWindow, Menu, app, session } from 'electron';
import path from 'path';
import { getAppRoot } from './paths.js';

export class WindowManager {
  private windows: Map<string, BrowserWindow> = new Map();

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

  /** Open the Install Gateway wizard window. */
  openInstall(): void {
    const existing = this.getWindow('install');
    if (existing) {
      existing.show();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 400,
      height: 350,
      resizable: false,
      title: 'Install terminar Gateway',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.registerWindow('install', win);
    this.loadUrl(win, 'install');
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
    this.loadUrl(win, 'settings');
  }

  /** Open the terminal desktop app window. */
  openTerminal(): void {
    const existing = this.getWindow('terminal');
    if (existing) {
      existing.show();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: 'terminar',
      webPreferences: {
        preload: this.terminalPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.registerWindow('terminal', win);
    this.loadTerminalUrl(win);
    this.setupTerminalMenu(win);
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

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /** Preload script path for tray windows (install, settings). */
  private preloadPath(): string {
    return path.join(getAppRoot(), 'dist-electron', 'index.mjs');
  }

  /** Preload script path for the terminal window. */
  private terminalPreloadPath(): string {
    return path.join(getAppRoot(), 'dist-electron', 'terminal.mjs');
  }

  private registerWindow(label: string, win: BrowserWindow): void {
    this.windows.set(label, win);

    // macOS: show Dock icon when a window is open
    if (process.platform === 'darwin') {
      app.dock?.show();
    }

    win.on('closed', () => {
      this.windows.delete(label);

      // macOS: hide Dock icon when all windows are closed
      if (process.platform === 'darwin' && !this.hasOpenWindows()) {
        app.dock?.hide();
      }
    });
  }

  /** Load a tray renderer page (install or settings). */
  private loadUrl(win: BrowserWindow, mode: string): void {
    // Dev mode: load from Vite dev server; Prod: load from file
    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

    if (VITE_DEV_SERVER_URL) {
      void win.loadURL(`${VITE_DEV_SERVER_URL}?mode=${mode}`);
    } else {
      // Production: load from built files at tray/dist/index.html
      const indexPath = path.join(getAppRoot(), 'dist', 'index.html');
      void win.loadFile(indexPath, { search: `mode=${mode}` });
    }
  }

  /** Load the terminal page (web frontend). */
  private loadTerminalUrl(win: BrowserWindow): void {
    const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

    if (VITE_DEV_SERVER_URL) {
      void win.loadURL(`${VITE_DEV_SERVER_URL}/terminal.html`);
    } else {
      const terminalPath = path.join(getAppRoot(), 'dist', 'terminal.html');
      void win.loadFile(terminalPath);
    }
  }

  /** Set Edit/View application menu when terminal window is focused. */
  private setupTerminalMenu(win: BrowserWindow): void {
    const isMac = process.platform === 'darwin';

    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
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
