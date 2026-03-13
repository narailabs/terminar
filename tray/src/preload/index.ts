import { contextBridge, ipcRenderer } from 'electron';
import type { TrayConfig } from '../main/types.js';

contextBridge.exposeInMainWorld('trayAPI', {
  getConfig: () => ipcRenderer.invoke('tray:get-config'),
  saveConfig: (config: TrayConfig) => ipcRenderer.invoke('tray:save-config', config),
  getServerStatus: () => ipcRenderer.invoke('tray:get-server-status'),
  startServer: () => ipcRenderer.invoke('tray:start-server'),
  stopServer: () => ipcRenderer.invoke('tray:stop-server'),
  closeWindow: () => ipcRenderer.invoke('tray:close-window'),
  checkWsl: () => ipcRenderer.invoke('wsl:check'),
});
