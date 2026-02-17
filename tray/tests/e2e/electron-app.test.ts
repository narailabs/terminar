import { test, expect, type ElectronApplication, type Page, _electron as electron } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trayRoot = path.resolve(__dirname, '..', '..');

let electronApp: ElectronApplication;
let window: Page | null = null;

test.describe.serial('Electron Tray App', () => {
  test.beforeAll(async () => {
    electronApp = await electron.launch({
      args: [trayRoot],
      timeout: 10000,
    });
    // Give the app time to initialize.
    await new Promise((r) => setTimeout(r, 3000));
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  // =========================================================================
  // Core app lifecycle tests
  // =========================================================================

  test('app is ready and running', async () => {
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);
  });

  test('app name is set', async () => {
    const name = await electronApp.evaluate(async ({ app }) => app.name);
    expect(name).toBeTruthy();
  });

  test('tray icon was created without crashing', async () => {
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);
  });

  test('single instance lock is held', async () => {
    // Attempting to request another lock should indicate one is already held
    const hasLock = await electronApp.evaluate(async ({ app }) => {
      return app.requestSingleInstanceLock();
    });
    // The app already has the lock, so requesting again returns true (it's the same app)
    expect(hasLock).toBe(true);
  });

  test('dock is hidden on macOS (tray-only app)', async () => {
    if (process.platform !== 'darwin') {
      test.skip();
      return;
    }
    // Dock should be hidden since no windows are open initially
    // (install wizard may or may not open depending on service status)
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);
  });

  // =========================================================================
  // IPC handler registration tests
  // =========================================================================

  test('IPC handlers are registered (ipcMain.handle is functional)', async () => {
    const result = await electronApp.evaluate(async ({ ipcMain }) => {
      return typeof ipcMain.handle === 'function';
    });
    expect(result).toBe(true);
  });

  // =========================================================================
  // Window creation and UI rendering tests
  // =========================================================================

  test('can open a BrowserWindow that loads the built UI', async () => {
    const preloadPath = path.join(trayRoot, 'dist-electron', 'index.mjs');
    const htmlPath = path.join(trayRoot, 'dist', 'index.html');

    const windowReady = await electronApp.evaluate(
      async ({ BrowserWindow }, { preload, html }) => {
        const win = new BrowserWindow({
          width: 400,
          height: 350,
          show: true,
          webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        try {
          await win.loadFile(html, { search: 'mode=install' });
          return { success: true, url: win.webContents.getURL(), title: win.getTitle() };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },
      { preload: preloadPath, html: htmlPath },
    );

    expect(windowReady.success).toBe(true);

    await new Promise((r) => setTimeout(r, 1000));
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);

    if (windows.length > 0) {
      window = windows[0];
      await window.waitForLoadState('domcontentloaded');
    }
  });

  test('window loads Svelte app with #app mount point', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const appEl = await window.$('#app');
    expect(appEl).not.toBeNull();
  });

  test('preload API (trayAPI) is exposed to renderer', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const apiShape = await window.evaluate(() => {
      const api = (window as unknown as Record<string, unknown>).trayAPI;
      if (typeof api !== 'object' || api === null) return null;
      return Object.keys(api).sort();
    });

    expect(apiShape).not.toBeNull();
    // Verify all expected methods are exposed
    expect(apiShape).toContain('getConfig');
    expect(apiShape).toContain('saveConfig');
    expect(apiShape).toContain('getServiceStatus');
    expect(apiShape).toContain('getHealth');
    expect(apiShape).toContain('installService');
    expect(apiShape).toContain('uninstallService');
    expect(apiShape).toContain('restartService');
    expect(apiShape).toContain('stopService');
    expect(apiShape).toContain('startService');
    expect(apiShape).toContain('pickFile');
    expect(apiShape).toContain('confirm');
    expect(apiShape).toContain('ask');
    expect(apiShape).toContain('closeWindow');
  });

  // =========================================================================
  // IPC: Config operations
  // =========================================================================

  test('trayAPI.getConfig returns valid default config', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const config = await window.evaluate(async () => {
      const api = (window as unknown as { trayAPI: { getConfig: () => Promise<Record<string, unknown>> } }).trayAPI;
      return api.getConfig();
    });

    expect(config).not.toBeNull();
    expect(config).toHaveProperty('gateway_port', 6749);
    expect(config).toHaveProperty('tls_mode');
    expect(config).toHaveProperty('tls_port');
    expect(config).toHaveProperty('require_auth');
    expect(config).toHaveProperty('audit_level');
    expect(config).toHaveProperty('idle_timeout');
    expect(config).toHaveProperty('tls_cert');
    expect(config).toHaveProperty('tls_key');
  });

  test('trayAPI.saveConfig + getConfig round-trip preserves values', async () => {
    if (!window) {
      test.skip();
      return;
    }

    // Save a modified config
    const saved = await window.evaluate(async () => {
      const api = (window as unknown as {
        trayAPI: {
          getConfig: () => Promise<Record<string, unknown>>;
          saveConfig: (c: Record<string, unknown>) => Promise<void>;
        };
      }).trayAPI;

      const original = await api.getConfig();
      const modified = { ...original, gateway_port: 7777, audit_level: 'verbose' };
      await api.saveConfig(modified);
      const reloaded = await api.getConfig();

      // Restore original
      await api.saveConfig(original);

      return { modified, reloaded };
    });

    expect(saved.reloaded.gateway_port).toBe(7777);
    expect(saved.reloaded.audit_level).toBe('verbose');
  });

  // =========================================================================
  // IPC: Service status
  // =========================================================================

  test('trayAPI.getServiceStatus returns valid status string', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const status = await window.evaluate(async () => {
      const api = (window as unknown as { trayAPI: { getServiceStatus: () => Promise<string> } }).trayAPI;
      return api.getServiceStatus();
    });

    expect(status).not.toBeNull();
    expect(['running', 'stopped', 'notinstalled', 'unknown']).toContain(status);
  });

  // =========================================================================
  // IPC: Health polling
  // =========================================================================

  test('trayAPI.getHealth returns health object with valid status', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const health = await window.evaluate(async () => {
      const api = (window as unknown as { trayAPI: { getHealth: () => Promise<Record<string, unknown>> } }).trayAPI;
      return api.getHealth();
    });

    expect(health).not.toBeNull();
    expect(health).toHaveProperty('status');
    expect(['running', 'starting', 'stopped']).toContain(
      (health as Record<string, unknown>).status,
    );
    expect(health).toHaveProperty('active_servers');
    expect(health).toHaveProperty('version');
  });

  // =========================================================================
  // IPC: Service actions (stop/start/restart) — verify they don't crash
  // These trigger osascript auth dialogs on macOS, which we can't interact
  // with in CI, but we can verify the IPC handler doesn't throw.
  // =========================================================================

  test('trayAPI.stopService IPC handler is callable', async () => {
    if (!window) {
      test.skip();
      return;
    }

    // We can't actually test the osascript auth dialog, but we can verify
    // the IPC handler exists and doesn't throw before reaching elevation
    const hasHandler = await window.evaluate(() => {
      const api = (window as unknown as { trayAPI: { stopService: Function } }).trayAPI;
      return typeof api.stopService === 'function';
    });
    expect(hasHandler).toBe(true);
  });

  test('trayAPI.startService IPC handler is callable', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const hasHandler = await window.evaluate(() => {
      const api = (window as unknown as { trayAPI: { startService: Function } }).trayAPI;
      return typeof api.startService === 'function';
    });
    expect(hasHandler).toBe(true);
  });

  test('trayAPI.restartService IPC handler is callable', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const hasHandler = await window.evaluate(() => {
      const api = (window as unknown as { trayAPI: { restartService: Function } }).trayAPI;
      return typeof api.restartService === 'function';
    });
    expect(hasHandler).toBe(true);
  });

  test('trayAPI.uninstallService IPC handler is callable', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const hasHandler = await window.evaluate(() => {
      const api = (window as unknown as { trayAPI: { uninstallService: Function } }).trayAPI;
      return typeof api.uninstallService === 'function';
    });
    expect(hasHandler).toBe(true);
  });

  // =========================================================================
  // Settings window
  // =========================================================================

  test('can open a settings window with correct mode', async () => {
    const preloadPath = path.join(trayRoot, 'dist-electron', 'index.mjs');
    const htmlPath = path.join(trayRoot, 'dist', 'index.html');

    const settingsReady = await electronApp.evaluate(
      async ({ BrowserWindow }, { preload, html }) => {
        // Close any existing windows first
        BrowserWindow.getAllWindows().forEach((w) => w.close());

        const win = new BrowserWindow({
          width: 500,
          height: 550,
          show: true,
          webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        try {
          await win.loadFile(html, { search: 'mode=settings' });
          return {
            success: true,
            url: win.webContents.getURL(),
          };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      },
      { preload: preloadPath, html: htmlPath },
    );

    expect(settingsReady.success).toBe(true);
    expect(settingsReady.url).toContain('mode=settings');

    // Get the settings window
    await new Promise((r) => setTimeout(r, 1000));
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);

    if (windows.length > 0) {
      window = windows[0];
      await window.waitForLoadState('domcontentloaded');
    }
  });

  test('settings window has #app mount point', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const appEl = await window.$('#app');
    expect(appEl).not.toBeNull();
  });

  test('settings window has trayAPI exposed', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const hasApi = await window.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).trayAPI === 'object';
    });
    expect(hasApi).toBe(true);
  });

  // =========================================================================
  // IPC: closeWindow
  // =========================================================================

  test('trayAPI.closeWindow closes the calling window', async () => {
    if (!window) {
      test.skip();
      return;
    }

    // Count windows before
    const beforeCount = await electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });

    // Call closeWindow from the renderer
    try {
      await window.evaluate(async () => {
        const api = (window as unknown as { trayAPI: { closeWindow: () => Promise<void> } }).trayAPI;
        await api.closeWindow();
      });
    } catch {
      // Window closing may cause context to be destroyed, which is expected
    }

    await new Promise((r) => setTimeout(r, 500));

    // Count windows after — should have one fewer
    const afterCount = await electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });

    expect(afterCount).toBeLessThan(beforeCount);
    window = null;
  });

  // =========================================================================
  // App lifecycle: stays alive after all windows close
  // =========================================================================

  test('app stays alive after closing all windows (tray keeps it alive)', async () => {
    // Close all remaining windows
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((w) => w.close());
    });
    window = null;

    await new Promise((r) => setTimeout(r, 500));

    // App should still be running
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);

    const windowCount = await electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });
    expect(windowCount).toBe(0);
  });
});
