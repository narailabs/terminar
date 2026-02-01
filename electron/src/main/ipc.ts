import { ipcMain, Notification, app } from 'electron';
import type { WindowManager } from './WindowManager.js';
import type { ConfigStore } from './ConfigStore.js';
import type { TrayManager, TraySession } from './TrayManager.js';

/**
 * Registers all IPC handlers for communication between main and renderer processes.
 * Groups handlers by feature area: window controls, config, notifications, and sessions.
 *
 * @param windowManager - The WindowManager instance for window control operations.
 * @param configStore - The ConfigStore instance for config operations.
 * @param trayManager - The TrayManager instance for tray menu updates.
 */
export function registerIpcHandlers(
  windowManager: WindowManager,
  configStore: ConfigStore,
  trayManager: TrayManager
): void {
  // Window control handlers (one-way messages)
  ipcMain.on('window:minimize', () => {
    const window = windowManager.getWindow();
    if (window) {
      window.minimize();
    }
  });

  ipcMain.on('window:maximize', () => {
    const window = windowManager.getWindow();
    if (window) {
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    const window = windowManager.getWindow();
    if (window) {
      // Hide to tray instead of closing
      window.hide();
    }
  });

  // Config handlers
  ipcMain.handle('config:get', () => {
    return configStore.getAll();
  });

  ipcMain.on('config:set', (_event, key: string, value: unknown) => {
    configStore.set(key, value);
  });

  // Notification handler
  ipcMain.on('notification:show', (_event, title: string, body: string) => {
    const notification = new Notification({ title, body });
    notification.show();
  });

  // Sessions handler
  ipcMain.on('sessions:changed', (_event, sessions: TraySession[]) => {
    trayManager.updateMenu(sessions);
  });

  // App version handler
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });
}
