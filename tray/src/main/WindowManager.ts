// WindowManager.ts — Manages named BrowserWindows for the tray app (settings).

import { BrowserWindow, app, session } from 'electron';
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
      const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'";

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

  /** Open the WSL install guide window (Windows only). */
  showWslGuide(): void {
    const existing = this.getWindow('wsl-guide');
    if (existing) {
      existing.show();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 480,
      height: 420,
      title: 'terminar — WSL Required',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.registerWindow('wsl-guide', win);
    this.loadUrl(win, 'wsl-guide');
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
      width: 400,
      height: 350,
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

  /** Preload script path for tray windows. */
  private preloadPath(): string {
    return path.join(getAppRoot(), 'dist-electron', 'index.mjs');
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

  /** Load a tray renderer page. */
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
}
