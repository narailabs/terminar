import { contextBridge, ipcRenderer } from 'electron';
import type { Config, SessionInfo, ElectronAPI } from '../types/electron-api.js';

/**
 * Electron API exposed to the renderer process via contextBridge.
 * Provides secure access to window controls, configuration, notifications,
 * and session management.
 */
const electronAPI: ElectronAPI = {
  /**
   * Minimize the window.
   */
  minimize: (): void => {
    ipcRenderer.send('window:minimize');
  },

  /**
   * Maximize the window.
   */
  maximize: (): void => {
    ipcRenderer.send('window:maximize');
  },

  /**
   * Close the window.
   */
  close: (): void => {
    ipcRenderer.send('window:close');
  },

  /**
   * Get the current configuration.
   * @returns Promise resolving to the configuration object.
   */
  getConfig: (): Promise<Config> => {
    return ipcRenderer.invoke('config:get');
  },

  /**
   * Set a configuration value.
   * @param key - The configuration key.
   * @param value - The value to set.
   */
  setConfig: (key: string, value: unknown): void => {
    ipcRenderer.send('config:set', key, value);
  },

  /**
   * Show a system notification.
   * @param title - The notification title.
   * @param body - The notification body text.
   */
  showNotification: (title: string, body: string): void => {
    ipcRenderer.send('notification:show', title, body);
  },

  /**
   * The current platform (darwin, win32, linux).
   */
  platform: process.platform,

  /**
   * Get the application version.
   * @returns Promise resolving to the version string.
   */
  getVersion: (): Promise<string> => {
    return ipcRenderer.invoke('app:getVersion');
  },

  /**
   * Register a callback for session changes from the main process.
   * @param callback - Function to call when sessions change.
   */
  onSessionsChanged: (callback: (sessions: SessionInfo[]) => void): void => {
    ipcRenderer.on('sessions:changed', (_event, sessions: SessionInfo[]) => {
      callback(sessions);
    });
  },

  /**
   * Notify the main process of session changes.
   * @param sessions - The updated sessions array.
   */
  notifySessionsChanged: (sessions: SessionInfo[]): void => {
    ipcRenderer.send('sessions:changed', sessions);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
