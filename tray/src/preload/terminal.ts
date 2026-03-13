import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('terminalAPI', {
  // Send a JSON message to the server via the main process Unix socket
  sendTerminalMessage: (msg: string) => ipcRenderer.send('terminal:message', msg),

  // Listen for messages from the server (forwarded by main process)
  onTerminalMessage: (callback: (msg: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on('terminal:response', handler);
    return () => ipcRenderer.removeListener('terminal:response', handler);
  },

  // Request the main process to connect to the server socket
  connect: (): Promise<void> => ipcRenderer.invoke('terminal:connect'),

  // Request the main process to disconnect from the server socket
  disconnect: () => ipcRenderer.send('terminal:disconnect'),

  // Get current connection state
  getConnectionState: (): Promise<string> => ipcRenderer.invoke('terminal:state'),
});

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
});
