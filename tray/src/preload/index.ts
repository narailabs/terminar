import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('trayAPI', {
  getConfig: () => ipcRenderer.invoke('tray:get-config'),
  saveConfig: (config: any) => ipcRenderer.invoke('tray:save-config', config),
  getServiceStatus: () => ipcRenderer.invoke('tray:get-service-status'),
  getHealth: () => ipcRenderer.invoke('tray:get-health'),
  installService: (config: any) => ipcRenderer.invoke('tray:install-service', config),
  uninstallService: () => ipcRenderer.invoke('tray:uninstall-service'),
  restartService: () => ipcRenderer.invoke('tray:restart-service'),
  stopService: () => ipcRenderer.invoke('tray:stop-service'),
  startService: () => ipcRenderer.invoke('tray:start-service'),
  pickFile: (options: { title: string; filters: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('tray:pick-file', options),
  confirm: (message: string, options: { title: string; kind: string }) =>
    ipcRenderer.invoke('tray:confirm', message, options),
  ask: (message: string, options: { title: string; kind: string }) =>
    ipcRenderer.invoke('tray:ask', message, options),
  closeWindow: () => ipcRenderer.invoke('tray:close-window'),
});
