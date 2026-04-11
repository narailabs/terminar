// ipc.ts — IPC handler registration.
// All IPC channels are prefixed with "tray:".

import { ipcMain, dialog, app, clipboard, shell } from 'electron';
import type { TrayConfig } from './types.js';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { WindowManager } from './WindowManager.js';

/**
 * Register all IPC handlers for the tray app.
 *
 * Uses `ipcMain.handle()` so that renderers can call these via
 * `ipcRenderer.invoke('tray:channel-name', ...args)`.
 */
export function registerIpcHandlers(
  configStore: ConfigStore,
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

  // ---- Health ----

  ipcMain.handle('tray:get-health', () => {
    return healthPoller.latestHealth;
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

  // ---- App info (used by terminal preload) ----

  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  // ---- Tool actions (OSC 52 clipboard / OSC 7777 open_url) ----
  // The server parses these OSC sequences out of the PTY output stream and
  // forwards them as ServerMessage variants. Terminal.svelte dispatches to
  // these IPC handlers, which perform the native action locally.

  ipcMain.handle('tray:clipboard-write', (_event, text: string) => {
    if (typeof text !== 'string') {
      return;
    }
    clipboard.writeText(text);
  });

  ipcMain.handle(
    'tray:open-url',
    async (_event, url: string): Promise<void> => {
      if (typeof url !== 'string') {
        return;
      }
      // Only allow safe schemes; ignore anything else silently so a
      // compromised remote can't coerce the local system into opening
      // arbitrary file:// or javascript: URLs.
      const allowedSchemes = ['http:', 'https:', 'mailto:'];
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return;
      }
      if (!allowedSchemes.includes(parsed.protocol)) {
        return;
      }
      await shell.openExternal(url);
    },
  );
}
