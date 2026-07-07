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
  /**
   * Stat an absolute filesystem path. Used by the terminal's file-path link
   * provider to decide whether a candidate path in PTY output should be
   * rendered as clickable. Returns `{ exists: false }` for any invalid input
   * or stat failure — never throws.
   */
  statPath: (absPath: string): Promise<{ exists: boolean; isFile: boolean }> =>
    ipcRenderer.invoke('tray:stat-path', absPath),
  /**
   * Open an absolute filesystem path with the OS default handler (Finder /
   * Preview on macOS, xdg-open on Linux, Explorer on Windows). Returns an
   * error string on failure or null on success.
   */
  openPath: (absPath: string): Promise<string | null> =>
    ipcRenderer.invoke('tray:open-path', absPath),
});

// Forward power events as DOM events so Terminal.svelte can recover
// from WebGL context loss after screen lock / sleep without depending
// on Electron APIs directly.
ipcRenderer.on('power:screen-unlocked', () => {
  document.dispatchEvent(new Event('terminar:screen-unlocked'));
});

// Bridges the renderer to the server's Unix domain socket via the main
// process (see tray/src/main/SocketBridge.ts) — the renderer is sandboxed
// and can't open the socket itself. `send`/`onMessage` are the streaming
// hot path for terminal I/O; `request` is a correlated request/response
// call used only for the settings/themes/tags/workspace-state RPCs.
contextBridge.exposeInMainWorld('terminarSocket', {
  connect: (): Promise<void> => ipcRenderer.invoke('terminar:socket:connect'),
  send: (json: string): void => ipcRenderer.send('terminar:socket:send', json),
  onMessage: (callback: (json: string) => void): void => {
    ipcRenderer.on('terminar:socket:message', (_event, json) => callback(json));
  },
  onClose: (callback: () => void): void => {
    ipcRenderer.on('terminar:socket:closed', () => callback());
  },
  disconnect: (): void => ipcRenderer.send('terminar:socket:disconnect'),
  state: (): Promise<string> => ipcRenderer.invoke('terminar:socket:state'),
  request: (json: string): Promise<string> => ipcRenderer.invoke('terminar:socket:request', json),
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
