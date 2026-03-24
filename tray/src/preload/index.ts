import { contextBridge, ipcRenderer } from 'electron';
import type { TrayConfig } from '../main/types.js';

contextBridge.exposeInMainWorld('multiWindow', {
  /** Get the tab ID assigned to this window by the MultiWindowCoordinator. */
  getAssignedTab: (): Promise<string | null> => ipcRenderer.invoke('multi-window:get-tab'),
  /** Listen for workspace mutations broadcast from other windows. */
  onWorkspaceUpdated: (callback: (mutation: unknown) => void) => {
    ipcRenderer.on('multi-window:workspace-updated', (_event, mutation) => callback(mutation));
  },
});

contextBridge.exposeInMainWorld('trayAPI', {
  getConfig: () => ipcRenderer.invoke('tray:get-config'),
  saveConfig: (config: TrayConfig) => ipcRenderer.invoke('tray:save-config', config),
  getServerStatus: () => ipcRenderer.invoke('tray:get-server-status'),
  startServer: () => ipcRenderer.invoke('tray:start-server'),
  stopServer: () => ipcRenderer.invoke('tray:stop-server'),
  closeWindow: () => ipcRenderer.invoke('tray:close-window'),
  checkWsl: () => ipcRenderer.invoke('wsl:check'),
});
