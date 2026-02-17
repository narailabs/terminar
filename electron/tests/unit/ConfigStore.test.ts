import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import type { Config, WindowConfig, GeneralConfig, TerminalConfig, ConnectionConfig, ShortcutsConfig } from '../../src/types/config.js';

// Mock storage object to simulate electron-store
const createMockStore = () => {
  const storage: Record<string, unknown> = {};
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => {
      return key in storage ? storage[key] : defaultValue;
    }),
    set: vi.fn((key: string, value: unknown) => {
      storage[key] = value;
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(storage)) {
        delete storage[key];
      }
    }),
    store: storage,
  };
};

// Mock electron-store before importing ConfigStore
vi.mock('electron-store', () => {
  const mockStore = createMockStore();
  const MockElectronStore = vi.fn().mockImplementation(() => mockStore);
  return { default: MockElectronStore };
});

describe('ConfigStore', () => {
  let ConfigStore: typeof import('../../src/main/ConfigStore.js').ConfigStore;
  let DEFAULT_CONFIG: Config;
  let mockElectronStoreInstance: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Create fresh mock store instance
    mockElectronStoreInstance = createMockStore();

    // Setup the mock
    const ElectronStore = (await import('electron-store')).default as unknown as Mock;
    ElectronStore.mockImplementation(() => mockElectronStoreInstance);

    // Import ConfigStore after mocks are set up
    const module = await import('../../src/main/ConfigStore.js');
    ConfigStore = module.ConfigStore;
    DEFAULT_CONFIG = module.DEFAULT_CONFIG;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have window configuration with default dimensions', () => {
      expect(DEFAULT_CONFIG.window).toEqual({
        x: null,
        y: null,
        width: 1200,
        height: 800,
        maximized: false,
      });
    });

    it('should have general configuration with sensible defaults', () => {
      expect(DEFAULT_CONFIG.general).toEqual({
        startAtLogin: false,
        minimizeToTray: true,
        showTrayIcon: true,
        alwaysOnTop: false,
      });
    });

    it('should have terminal configuration with default font settings', () => {
      expect(DEFAULT_CONFIG.terminal).toEqual({
        fontFamily: "Menlo, Monaco, 'Courier New', monospace",
        fontSize: 14,
        theme: 'dark',
        scrollback: 10000,
      });
    });

    it('should have connection configuration with localhost default', () => {
      expect(DEFAULT_CONFIG.connection).toEqual({
        defaultServer: 'ws://localhost:6749',
        autoReconnect: true,
        reconnectDelay: 5,
        savedServers: [],
      });
    });

    it('should have shortcuts configuration with default keybindings', () => {
      expect(DEFAULT_CONFIG.shortcuts).toEqual({
        showHide: 'CommandOrControl+Shift+T',
        newSession: 'CommandOrControl+Shift+N',
        nextSession: 'CommandOrControl+Tab',
        prevSession: 'CommandOrControl+Shift+Tab',
      });
    });
  });

  describe('get', () => {
    it('should return correct value for existing key', () => {
      const store = new ConfigStore();
      // Simulate stored value
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'general.alwaysOnTop') return true;
        return defaultValue;
      });

      const value = store.get('general.alwaysOnTop');
      expect(value).toBe(true);
    });

    it('should return default value for missing key', () => {
      const store = new ConfigStore();
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => defaultValue);

      const value = store.get('general.alwaysOnTop');
      // Should return the default from DEFAULT_CONFIG
      expect(value).toBe(false);
    });

    it('should return window config section', () => {
      const store = new ConfigStore();
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => defaultValue);

      const windowConfig = store.get('window') as WindowConfig;
      expect(windowConfig.width).toBe(1200);
      expect(windowConfig.height).toBe(800);
    });

    it('should return terminal config section', () => {
      const store = new ConfigStore();
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => defaultValue);

      const terminalConfig = store.get('terminal') as TerminalConfig;
      expect(terminalConfig.fontSize).toBe(14);
      expect(terminalConfig.theme).toBe('dark');
    });
  });

  describe('set', () => {
    it('should persist config value', () => {
      const store = new ConfigStore();
      store.set('general.alwaysOnTop', true);

      expect(mockElectronStoreInstance.set).toHaveBeenCalledWith('general.alwaysOnTop', true);
    });

    it('should persist nested window values', () => {
      const store = new ConfigStore();
      store.set('window.width', 1400);

      expect(mockElectronStoreInstance.set).toHaveBeenCalledWith('window.width', 1400);
    });

    it('should persist terminal settings', () => {
      const store = new ConfigStore();
      store.set('terminal.fontSize', 16);

      expect(mockElectronStoreInstance.set).toHaveBeenCalledWith('terminal.fontSize', 16);
    });

    it('should persist entire section object', () => {
      const store = new ConfigStore();
      const newShortcuts: ShortcutsConfig = {
        showHide: 'CommandOrControl+Shift+P',
        newSession: 'CommandOrControl+Shift+M',
        nextSession: 'CommandOrControl+Tab',
        prevSession: 'CommandOrControl+Shift+Tab',
      };
      store.set('shortcuts', newShortcuts);

      expect(mockElectronStoreInstance.set).toHaveBeenCalledWith('shortcuts', newShortcuts);
    });
  });

  describe('getAll', () => {
    it('should return complete config object', () => {
      const store = new ConfigStore();
      // Mock store.get to return stored values or defaults
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'window') return DEFAULT_CONFIG.window;
        if (key === 'general') return DEFAULT_CONFIG.general;
        if (key === 'terminal') return DEFAULT_CONFIG.terminal;
        if (key === 'connection') return DEFAULT_CONFIG.connection;
        if (key === 'shortcuts') return DEFAULT_CONFIG.shortcuts;
        return defaultValue;
      });

      const config = store.getAll();

      expect(config).toHaveProperty('window');
      expect(config).toHaveProperty('general');
      expect(config).toHaveProperty('terminal');
      expect(config).toHaveProperty('connection');
      expect(config).toHaveProperty('shortcuts');
    });

    it('should return config with all sections populated', () => {
      const store = new ConfigStore();
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => defaultValue);

      const config = store.getAll();

      expect(config.window.width).toBe(1200);
      expect(config.general.minimizeToTray).toBe(true);
      expect(config.terminal.fontSize).toBe(14);
      expect(config.connection.defaultServer).toBe('ws://localhost:6749');
      expect(config.shortcuts.showHide).toBe('CommandOrControl+Shift+T');
    });

    it('should merge stored values with defaults', () => {
      const store = new ConfigStore();
      const customGeneral = { ...DEFAULT_CONFIG.general, alwaysOnTop: true };
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'general') return customGeneral;
        return defaultValue;
      });

      const config = store.getAll();

      expect(config.general.alwaysOnTop).toBe(true);
      expect(config.general.minimizeToTray).toBe(true); // Still has other defaults
    });
  });

  describe('reset', () => {
    it('should restore default values', () => {
      const store = new ConfigStore();
      store.reset();

      expect(mockElectronStoreInstance.clear).toHaveBeenCalled();
    });

    it('should make getAll return defaults after reset', () => {
      const store = new ConfigStore();
      mockElectronStoreInstance.get.mockImplementation((key: string, defaultValue?: unknown) => defaultValue);

      store.reset();
      const config = store.getAll();

      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('Config type definitions', () => {
    it('should have correctly typed window config', () => {
      // TypeScript compilation test - if this compiles, types are correct
      const windowConfig: WindowConfig = {
        x: 100,
        y: 100,
        width: 1200,
        height: 800,
        maximized: false,
      };
      expect(windowConfig.width).toBe(1200);
    });

    it('should allow null for window position', () => {
      const windowConfig: WindowConfig = {
        x: null,
        y: null,
        width: 1200,
        height: 800,
        maximized: false,
      };
      expect(windowConfig.x).toBeNull();
      expect(windowConfig.y).toBeNull();
    });

    it('should have correctly typed general config', () => {
      const generalConfig: GeneralConfig = {
        startAtLogin: false,
        minimizeToTray: true,
        showTrayIcon: true,
        alwaysOnTop: false,
      };
      expect(typeof generalConfig.startAtLogin).toBe('boolean');
    });

    it('should have correctly typed terminal config', () => {
      const terminalConfig: TerminalConfig = {
        fontFamily: 'Menlo',
        fontSize: 14,
        theme: 'dark',
        scrollback: 10000,
      };
      expect(typeof terminalConfig.fontSize).toBe('number');
      expect(typeof terminalConfig.fontFamily).toBe('string');
    });

    it('should have correctly typed connection config', () => {
      const connectionConfig: ConnectionConfig = {
        defaultServer: 'ws://localhost:6749',
        autoReconnect: true,
        reconnectDelay: 5,
        savedServers: [],
      };
      expect(Array.isArray(connectionConfig.savedServers)).toBe(true);
    });

    it('should have correctly typed shortcuts config', () => {
      const shortcutsConfig: ShortcutsConfig = {
        showHide: 'CommandOrControl+Shift+T',
        newSession: 'CommandOrControl+Shift+N',
        nextSession: 'CommandOrControl+Tab',
        prevSession: 'CommandOrControl+Shift+Tab',
      };
      expect(typeof shortcutsConfig.showHide).toBe('string');
    });

    it('should have correctly typed full config', () => {
      const config: Config = DEFAULT_CONFIG;
      expect(config).toHaveProperty('window');
      expect(config).toHaveProperty('general');
      expect(config).toHaveProperty('terminal');
      expect(config).toHaveProperty('connection');
      expect(config).toHaveProperty('shortcuts');
    });
  });
});
