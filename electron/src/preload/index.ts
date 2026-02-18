import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
});
