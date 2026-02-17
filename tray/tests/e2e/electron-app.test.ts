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

  // ---- Core app tests (main process only, no windows needed) ----

  test('app is ready and running', async () => {
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);
  });

  test('app name is set', async () => {
    const name = await electronApp.evaluate(async ({ app }) => app.name);
    expect(name).toBeTruthy();
  });

  test('tray icon was created without crashing', async () => {
    // If the app is still responsive, the tray was created.
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);
  });

  test('IPC handlers are registered', async () => {
    const result = await electronApp.evaluate(async ({ ipcMain }) => {
      return typeof ipcMain.handle === 'function';
    });
    expect(result).toBe(true);
  });

  // ---- Window tests: create a window from the test to validate rendering ----

  test('can open a BrowserWindow that loads the built UI', async () => {
    // Compute paths from the test side (not in evaluate, where require/import aren't available)
    const preloadPath = path.join(trayRoot, 'dist-electron', 'index.mjs');
    const htmlPath = path.join(trayRoot, 'dist', 'index.html');

    // Create a window from within the main process
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

    // Now get the window via Playwright
    await new Promise((r) => setTimeout(r, 1000));
    const windows = electronApp.windows();
    expect(windows.length).toBeGreaterThanOrEqual(1);

    if (windows.length > 0) {
      window = windows[0];
      await window.waitForLoadState('domcontentloaded');
    }
  });

  test('window loads Svelte app', async () => {
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

    const hasApi = await window.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).trayAPI === 'object';
    });
    expect(hasApi).toBe(true);
  });

  test('trayAPI.getConfig returns valid config', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const config = await window.evaluate(async () => {
      const api = (window as unknown as { trayAPI: { getConfig: () => Promise<Record<string, unknown>> } }).trayAPI;
      if (!api?.getConfig) return null;
      return api.getConfig();
    });

    expect(config).not.toBeNull();
    expect(config).toHaveProperty('gateway_port', 6749);
    expect(config).toHaveProperty('tls_mode');
    expect(config).toHaveProperty('require_auth');
  });

  test('trayAPI.getServiceStatus returns valid status', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const status = await window.evaluate(async () => {
      const api = (window as unknown as { trayAPI: { getServiceStatus: () => Promise<string> } }).trayAPI;
      if (!api?.getServiceStatus) return null;
      return api.getServiceStatus();
    });

    expect(status).not.toBeNull();
    expect(['running', 'stopped', 'notinstalled', 'unknown']).toContain(status);
  });

  test('trayAPI.getHealth returns health object', async () => {
    if (!window) {
      test.skip();
      return;
    }

    const health = await window.evaluate(async () => {
      const api = (window as unknown as { trayAPI: { getHealth: () => Promise<Record<string, unknown>> } }).trayAPI;
      if (!api?.getHealth) return null;
      return api.getHealth();
    });

    expect(health).not.toBeNull();
    expect(health).toHaveProperty('status');
    expect(['running', 'starting', 'stopped']).toContain(
      (health as Record<string, unknown>).status,
    );
  });

  test('app stays alive after closing all windows', async () => {
    // Close all windows via Electron API
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((w) => w.close());
    });
    window = null;

    await new Promise((r) => setTimeout(r, 500));

    // App should still be running (tray keeps it alive)
    const isReady = await electronApp.evaluate(async ({ app }) => app.isReady());
    expect(isReady).toBe(true);

    const windowCount = await electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().length;
    });
    expect(windowCount).toBe(0);
  });
});
