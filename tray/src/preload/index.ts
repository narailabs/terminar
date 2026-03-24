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
  getHealth: () => ipcRenderer.invoke('tray:get-health'),
  pickFile: (options: { title: string; filters: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('tray:pick-file', options),
  confirm: (message: string, options: { title: string; kind: string }) =>
    ipcRenderer.invoke('tray:confirm', message, options),
  ask: (message: string, options: { title: string; kind: string }) =>
    ipcRenderer.invoke('tray:ask', message, options),
  closeWindow: () => ipcRenderer.invoke('tray:close-window'),
});
