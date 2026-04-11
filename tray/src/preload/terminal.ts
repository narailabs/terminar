import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /**
   * Write `text` to the user's local system clipboard. Called in response
   * to an OSC 52 clipboard-write event that the server parsed out of the
   * remote session's output stream.
   */
  clipboardWrite: (text: string): Promise<void> =>
    ipcRenderer.invoke('tray:clipboard-write', text),
  /**
   * Open `url` in the user's local default browser. Called in response to
   * an OSC 7777 `open_url` event. The main process validates the URL
   * scheme (http / https / mailto only).
   */
  openUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('tray:open-url', url),
});

contextBridge.exposeInMainWorld('multiWindow', {
  /** Get the tab ID assigned to this window by the MultiWindowCoordinator. */
  getAssignedTab: (): Promise<string | null> => ipcRenderer.invoke('multi-window:get-tab'),
  /** Listen for workspace mutations broadcast from other windows. */
  onWorkspaceUpdated: (callback: (mutation: unknown) => void) => {
    ipcRenderer.on('multi-window:workspace-updated', (_event, mutation) => callback(mutation));
  },
  /** Notify other windows of a workspace mutation from this window. */
  sendWorkspaceMutation: (mutation: unknown) => {
    ipcRenderer.send('multi-window:workspace-mutation', mutation);
  },
});
