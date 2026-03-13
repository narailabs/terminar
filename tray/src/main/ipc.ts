// ipc.ts — IPC handler registration.
// All IPC channels are prefixed with "tray:".

import { ipcMain, app } from 'electron';
import type { TrayConfig } from './types.js';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { ServerManager } from './ServerManager.js';
import { WindowManager } from './WindowManager.js';

/**
 * Register all IPC handlers for the tray app.
 *
 * Uses `ipcMain.handle()` so that renderers can call these via
 * `ipcRenderer.invoke('tray:channel-name', ...args)`.
 */
export function registerIpcHandlers(
  configStore: ConfigStore,
  serverManager: ServerManager,
  healthPoller: HealthPoller,
  windowManager: WindowManager,
): void {
  // ---- Config ----

  ipcMain.handle('tray:get-config', () => {
    return configStore.load();
  });

  ipcMain.handle(
    'tray:save-config',
    (_event, config: TrayConfig) => {
      configStore.save(config);
    },
  );

  // ---- Server status ----

  ipcMain.handle('tray:get-server-status', () => {
    return healthPoller.latestStatus;
  });

  // ---- Server actions ----

  ipcMain.handle('tray:start-server', async () => {
    await serverManager.start();
  });

  ipcMain.handle('tray:stop-server', async () => {
    await serverManager.stop();
  });

  // ---- Window control ----

  ipcMain.handle('tray:close-window', (event) => {
    windowManager.closeWindowById(event.sender.id);
  });

  // ---- App info ----

  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });
}
