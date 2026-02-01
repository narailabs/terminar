/**
 * Configuration interface for the application.
 */
export interface Config {
  [key: string]: unknown;
}

/**
 * Session information for session change events.
 */
export interface SessionInfo {
  id: string;
  name: string;
  status: 'active' | 'inactive';
}

/**
 * Electron API exposed to the renderer process via contextBridge.
 */
export interface ElectronAPI {
  /** Minimize the window */
  minimize: () => void;
  /** Maximize the window */
  maximize: () => void;
  /** Close the window */
  close: () => void;
  /** Get the current configuration */
  getConfig: () => Promise<Config>;
  /** Set a configuration value */
  setConfig: (key: string, value: unknown) => void;
  /** Show a system notification */
  showNotification: (title: string, body: string) => void;
  /** The current platform (darwin, win32, linux) */
  platform: NodeJS.Platform;
  /** Get the application version */
  getVersion: () => Promise<string>;
  /** Register a callback for session changes */
  onSessionsChanged: (callback: (sessions: SessionInfo[]) => void) => void;
  /** Notify main process of session changes */
  notifySessionsChanged: (sessions: SessionInfo[]) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
