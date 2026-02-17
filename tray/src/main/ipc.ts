// ipc.ts — IPC handler registration.
// Port of command handlers from tray/src-tauri/src/commands.rs.
// All IPC channels are prefixed with "tray:".

import { ipcMain, dialog } from 'electron';
import type { TrayConfig } from './types.js';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { ServiceManager } from './ServiceManager.js';
import { WindowManager } from './WindowManager.js';
import { runElevated } from './elevation.js';

/**
 * Register all IPC handlers for the tray app.
 *
 * Uses `ipcMain.handle()` so that renderers can call these via
 * `ipcRenderer.invoke('tray:channel-name', ...args)`.
 */
export function registerIpcHandlers(
  configStore: ConfigStore,
  serviceManager: ServiceManager,
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

  // ---- Service status ----

  ipcMain.handle('tray:get-service-status', () => {
    return serviceManager.status();
  });

  // ---- Health ----

  ipcMain.handle('tray:get-health', () => {
    return healthPoller.latestHealth;
  });

  // ---- Service actions ----

  ipcMain.handle(
    'tray:install-service',
    (_event, config: TrayConfig) => {
      const gatewayBin = serviceManager.findBinary(
        'terminar-gateway',
      );
      if (!gatewayBin) {
        throw new Error('Could not find terminar-gateway binary');
      }

      const serverBin = serviceManager.findBinary('terminar-server');
      if (!serverBin) {
        throw new Error('Could not find terminar-server binary');
      }

      const script = serviceManager.installScript(
        config,
        gatewayBin,
        serverBin,
      );
      runElevated(script);
    },
  );

  ipcMain.handle('tray:uninstall-service', () => {
    const script = serviceManager.uninstallScript();
    runElevated(script);
  });

  ipcMain.handle('tray:restart-service', () => {
    const script = serviceManager.restartScript();
    runElevated(script);
  });

  ipcMain.handle('tray:stop-service', () => {
    const script = serviceManager.stopScript();
    runElevated(script);
  });

  ipcMain.handle('tray:start-service', () => {
    const script = serviceManager.startScript();
    runElevated(script);
  });

  // ---- Dialogs ----

  ipcMain.handle(
    'tray:pick-file',
    async (
      _event,
      options?: { title?: string; filters?: Electron.FileFilter[] },
    ) => {
      const result = await dialog.showOpenDialog({
        title: options?.title,
        properties: ['openFile'],
        filters: options?.filters,
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    },
  );

  ipcMain.handle(
    'tray:confirm',
    async (
      _event,
      message: string,
      options?: { title?: string; kind?: string },
    ) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 1,
        cancelId: 1,
        title: options?.title ?? 'Confirm',
        message,
      });
      return result.response === 0; // true if "Yes"
    },
  );

  ipcMain.handle(
    'tray:ask',
    async (
      _event,
      message: string,
      options?: { title?: string; kind?: string },
    ) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        cancelId: 1,
        title: options?.title ?? 'Question',
        message,
      });
      return result.response === 0; // true if "Yes"
    },
  );

  // ---- Window control ----

  ipcMain.handle('tray:close-window', (event) => {
    windowManager.closeWindowById(event.sender.id);
  });
}
