/**
 * Window state configuration.
 */
export interface WindowConfig {
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  maximized: boolean;
}

/**
 * General application settings.
 */
export interface GeneralConfig {
  startAtLogin: boolean;
  minimizeToTray: boolean;
  showTrayIcon: boolean;
  alwaysOnTop: boolean;
}

/**
 * Terminal display settings.
 */
export interface TerminalConfig {
  fontFamily: string;
  fontSize: number;
  theme: string;
  scrollback: number;
}

/**
 * Saved server configuration.
 */
export interface SavedServer {
  url: string;
  name: string;
  autoConnect: boolean;
}

/**
 * Connection settings.
 */
export interface ConnectionConfig {
  defaultServer: string;
  autoReconnect: boolean;
  reconnectDelay: number;
  savedServers: SavedServer[];
}

/**
 * Keyboard shortcut configuration.
 */
export interface ShortcutsConfig {
  showHide: string;
  newSession: string;
  nextSession: string;
  prevSession: string;
}

/**
 * Full application configuration interface.
 */
export interface Config {
  window: WindowConfig;
  general: GeneralConfig;
  terminal: TerminalConfig;
  connection: ConnectionConfig;
  shortcuts: ShortcutsConfig;
}
