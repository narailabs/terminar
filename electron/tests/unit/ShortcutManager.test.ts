import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock globalShortcut
const mockGlobalShortcut = {
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
  isRegistered: vi.fn(),
};

// Mock ConfigStore
const mockConfigStore = {
  get: vi.fn(),
};

// Mock electron before importing ShortcutManager
vi.mock('electron', () => ({
  globalShortcut: mockGlobalShortcut,
}));

describe('ShortcutManager', () => {
  let ShortcutManager: typeof import('../../src/main/ShortcutManager.js').ShortcutManager;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Reset mock implementations
    mockGlobalShortcut.register.mockReturnValue(true);
    mockGlobalShortcut.unregister.mockReturnValue(undefined);
    mockGlobalShortcut.unregisterAll.mockReturnValue(undefined);
    mockGlobalShortcut.isRegistered.mockReturnValue(false);

    // Import ShortcutManager after mocks are set up
    const module = await import('../../src/main/ShortcutManager.js');
    ShortcutManager = module.ShortcutManager;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('register', () => {
    it('should call globalShortcut.register with accelerator and callback', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();

      manager.register('CommandOrControl+Shift+T', callback);

      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Shift+T',
        callback
      );
    });

    it('should return true when registration succeeds', () => {
      mockGlobalShortcut.register.mockReturnValue(true);
      const manager = new ShortcutManager();
      const callback = vi.fn();

      const result = manager.register('CommandOrControl+Shift+T', callback);

      expect(result).toBe(true);
    });

    it('should track registered shortcuts internally', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();

      manager.register('CommandOrControl+Shift+T', callback);

      expect(manager.getRegisteredShortcuts()).toContain('CommandOrControl+Shift+T');
    });
  });

  describe('unregister', () => {
    it('should call globalShortcut.unregister with accelerator', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();
      manager.register('CommandOrControl+Shift+T', callback);

      manager.unregister('CommandOrControl+Shift+T');

      expect(mockGlobalShortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+T');
    });

    it('should remove shortcut from internal tracking', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();
      manager.register('CommandOrControl+Shift+T', callback);

      manager.unregister('CommandOrControl+Shift+T');

      expect(manager.getRegisteredShortcuts()).not.toContain('CommandOrControl+Shift+T');
    });

    it('should not throw when unregistering non-existent shortcut', () => {
      const manager = new ShortcutManager();

      expect(() => manager.unregister('CommandOrControl+Shift+X')).not.toThrow();
    });
  });

  describe('unregisterAll', () => {
    it('should call globalShortcut.unregisterAll', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();
      manager.register('CommandOrControl+Shift+T', callback);
      manager.register('CommandOrControl+Shift+N', callback);

      manager.unregisterAll();

      expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
    });

    it('should clear internal tracking of all shortcuts', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();
      manager.register('CommandOrControl+Shift+T', callback);
      manager.register('CommandOrControl+Shift+N', callback);

      manager.unregisterAll();

      expect(manager.getRegisteredShortcuts()).toHaveLength(0);
    });

    it('should not throw when called with no registered shortcuts', () => {
      const manager = new ShortcutManager();

      expect(() => manager.unregisterAll()).not.toThrow();
    });
  });

  describe('reloadFromConfig', () => {
    it('should unregister all existing shortcuts before re-registering', () => {
      const manager = new ShortcutManager();
      const callback = vi.fn();
      manager.register('CommandOrControl+Shift+X', callback);

      const mockConfig = {
        get: vi.fn().mockReturnValue({
          showHide: 'CommandOrControl+Shift+T',
          newSession: 'CommandOrControl+Shift+N',
        }),
      };
      const actions = {
        showHide: vi.fn(),
        newSession: vi.fn(),
      };

      manager.reloadFromConfig(mockConfig, actions);

      expect(mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
    });

    it('should read shortcuts config from config store', () => {
      const manager = new ShortcutManager();
      const mockConfig = {
        get: vi.fn().mockReturnValue({
          showHide: 'CommandOrControl+Shift+T',
          newSession: 'CommandOrControl+Shift+N',
        }),
      };
      const actions = {
        showHide: vi.fn(),
        newSession: vi.fn(),
      };

      manager.reloadFromConfig(mockConfig, actions);

      expect(mockConfig.get).toHaveBeenCalledWith('shortcuts');
    });

    it('should register showHide shortcut with correct action', () => {
      const manager = new ShortcutManager();
      const mockConfig = {
        get: vi.fn().mockReturnValue({
          showHide: 'CommandOrControl+Shift+T',
          newSession: 'CommandOrControl+Shift+N',
        }),
      };
      const actions = {
        showHide: vi.fn(),
        newSession: vi.fn(),
      };

      manager.reloadFromConfig(mockConfig, actions);

      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Shift+T',
        actions.showHide
      );
    });

    it('should register newSession shortcut with correct action', () => {
      const manager = new ShortcutManager();
      const mockConfig = {
        get: vi.fn().mockReturnValue({
          showHide: 'CommandOrControl+Shift+T',
          newSession: 'CommandOrControl+Shift+N',
        }),
      };
      const actions = {
        showHide: vi.fn(),
        newSession: vi.fn(),
      };

      manager.reloadFromConfig(mockConfig, actions);

      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Shift+N',
        actions.newSession
      );
    });

    it('should use default shortcuts when config values are missing', () => {
      const manager = new ShortcutManager();
      const mockConfig = {
        get: vi.fn().mockReturnValue({}),
      };
      const actions = {
        showHide: vi.fn(),
        newSession: vi.fn(),
      };

      manager.reloadFromConfig(mockConfig, actions);

      // Should use defaults: CommandOrControl+Shift+T and CommandOrControl+Shift+N
      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Shift+T',
        actions.showHide
      );
      expect(mockGlobalShortcut.register).toHaveBeenCalledWith(
        'CommandOrControl+Shift+N',
        actions.newSession
      );
    });
  });

  describe('registration failure handling', () => {
    it('should return false when registration fails', () => {
      mockGlobalShortcut.register.mockReturnValue(false);
      const manager = new ShortcutManager();
      const callback = vi.fn();

      const result = manager.register('CommandOrControl+Shift+T', callback);

      expect(result).toBe(false);
    });

    it('should not track shortcut internally when registration fails', () => {
      mockGlobalShortcut.register.mockReturnValue(false);
      const manager = new ShortcutManager();
      const callback = vi.fn();

      manager.register('CommandOrControl+Shift+T', callback);

      expect(manager.getRegisteredShortcuts()).not.toContain('CommandOrControl+Shift+T');
    });

    it('should not throw when registration fails', () => {
      mockGlobalShortcut.register.mockReturnValue(false);
      const manager = new ShortcutManager();
      const callback = vi.fn();

      expect(() => manager.register('CommandOrControl+Shift+T', callback)).not.toThrow();
    });

    it('should continue registering other shortcuts when one fails in reloadFromConfig', () => {
      // First registration fails, second succeeds
      mockGlobalShortcut.register
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const manager = new ShortcutManager();
      const mockConfig = {
        get: vi.fn().mockReturnValue({
          showHide: 'CommandOrControl+Shift+T',
          newSession: 'CommandOrControl+Shift+N',
        }),
      };
      const actions = {
        showHide: vi.fn(),
        newSession: vi.fn(),
      };

      expect(() => manager.reloadFromConfig(mockConfig, actions)).not.toThrow();

      // Both should be attempted
      expect(mockGlobalShortcut.register).toHaveBeenCalledTimes(2);
    });

    it('should handle registration throwing an error gracefully', () => {
      mockGlobalShortcut.register.mockImplementation(() => {
        throw new Error('Registration failed');
      });

      const manager = new ShortcutManager();
      const callback = vi.fn();

      // Should not throw
      expect(() => manager.register('CommandOrControl+Shift+T', callback)).not.toThrow();
    });
  });
});
