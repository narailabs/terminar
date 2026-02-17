import Store from 'electron-store';
import type { Config, WindowConfig, GeneralConfig, TerminalConfig, ConnectionConfig, ShortcutsConfig } from '../types/config.js';

/**
 * Default configuration values matching SPEC-ELECTRON.md section 7.1.
 */
export const DEFAULT_CONFIG: Config = {
  window: {
    x: null,
    y: null,
    width: 1200,
    height: 800,
    maximized: false,
  },
  general: {
    startAtLogin: false,
    minimizeToTray: true,
    showTrayIcon: true,
    alwaysOnTop: false,
  },
  terminal: {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 14,
    theme: 'dark',
    scrollback: 10000,
  },
  connection: {
    defaultServer: 'ws://localhost:6749',
    autoReconnect: true,
    reconnectDelay: 5,
    savedServers: [],
  },
  shortcuts: {
    showHide: 'CommandOrControl+Shift+T',
    newSession: 'CommandOrControl+Shift+N',
    nextSession: 'CommandOrControl+Tab',
    prevSession: 'CommandOrControl+Shift+Tab',
  },
};

/**
 * ConfigStore provides persistent storage for application configuration.
 * Uses electron-store for cross-platform JSON file persistence.
 *
 * Storage locations:
 * - macOS: ~/Library/Application Support/termiNar/config.json
 * - Windows: %APPDATA%/termiNar/config.json
 * - Linux: ~/.config/termiNar/config.json
 */
export class ConfigStore {
  private store: Store;

  constructor() {
    this.store = new Store({
      name: 'config',
      defaults: DEFAULT_CONFIG,
    });
  }

  /**
   * Gets a configuration value by key path.
   * Supports dot notation for nested keys (e.g., 'window.width').
   * @param key - The configuration key path.
   * @returns The configuration value or the default if not set.
   */
  get<K extends keyof Config>(key: K): Config[K];
  get(key: string): unknown;
  get(key: string): unknown {
    // For section keys, return the whole section
    if (key in DEFAULT_CONFIG) {
      return this.store.get(key, DEFAULT_CONFIG[key as keyof Config]);
    }

    // For dot notation keys (e.g., 'general.alwaysOnTop')
    const parts = key.split('.');
    if (parts.length === 2) {
      const [section, prop] = parts;
      const sectionKey = section as keyof Config;
      if (sectionKey in DEFAULT_CONFIG) {
        const sectionDefault = DEFAULT_CONFIG[sectionKey] as Record<string, unknown>;
        const defaultValue = sectionDefault[prop];
        return this.store.get(key, defaultValue);
      }
    }

    return this.store.get(key);
  }

  /**
   * Sets a configuration value by key path.
   * Supports dot notation for nested keys (e.g., 'window.width').
   * @param key - The configuration key path.
   * @param value - The value to set.
   */
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /**
   * Gets the complete configuration object.
   * Merges stored values with defaults to ensure all fields are present.
   * @returns The full configuration object.
   */
  getAll(): Config {
    return {
      window: this.get('window') as WindowConfig,
      general: this.get('general') as GeneralConfig,
      terminal: this.get('terminal') as TerminalConfig,
      connection: this.get('connection') as ConnectionConfig,
      shortcuts: this.get('shortcuts') as ShortcutsConfig,
    };
  }

  /**
   * Resets all configuration values to their defaults.
   * Clears the store and relies on default values being returned.
   */
  reset(): void {
    this.store.clear();
  }
}
