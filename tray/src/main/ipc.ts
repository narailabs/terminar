// ipc.ts — IPC handler registration.
// All IPC channels are prefixed with "tray:".

import { ipcMain, dialog, app, clipboard, shell } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

  // ---- File-path links (Cmd/Ctrl-click on file paths in terminal output) ----
  // Renderer detects candidate paths with a regex and resolves relatives
  // against the per-session cwd. Before making a path clickable the renderer
  // calls `tray:stat-path` to verify the file exists. On click it calls
  // `tray:open-path` which dispatches to the OS default viewer.

  ipcMain.handle(
    'tray:stat-path',
    async (_event, filePath: string): Promise<{ exists: boolean; isFile: boolean }> => {
      const abs = validateAndExpand(filePath);
      if (abs === null) return { exists: false, isFile: false };
      try {
        const st = await Promise.race([
          fs.promises.stat(abs),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('stat timeout')), 500),
          ),
        ]);
        return { exists: true, isFile: st.isFile() };
      } catch {
        return { exists: false, isFile: false };
      }
    },
  );

  ipcMain.handle(
    'tray:open-path',
    async (_event, filePath: string): Promise<string | null> => {
      const abs = validateAndExpand(filePath);
      if (abs === null) return 'invalid path';
      // shell.openPath returns "" on success, or an error string. Never throws.
      const result = await shell.openPath(abs);
      return result || null;
    },
  );
}

/**
 * Validate a file-path argument arriving over IPC. Returns an absolute path
 * on success, or null if the argument is not acceptable. Performs defense-in-
 * depth checks: even though the renderer resolves paths before calling, a
 * compromised renderer or malicious OSC stream must not be able to coerce
 * the main process into opening arbitrary paths.
 */
function validateAndExpand(filePath: unknown): string | null {
  if (typeof filePath !== 'string') return null;
  if (filePath.length === 0 || filePath.length > 4096) return null;
  if (filePath.includes('\0')) return null;
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  if (filePath === '~') {
    return os.homedir();
  }
  if (filePath.startsWith('/')) {
    return filePath;
  }
  return null;
}
