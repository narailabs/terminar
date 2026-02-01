import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to track the handlers that get registered
let ipcHandlers: Map<string, (...args: unknown[]) => unknown>;
let ipcListeners: Map<string, (...args: unknown[]) => void>;

// Create fresh mocks for each test - the maps need to be reset per test
const createMockIpcMain = () => {
  ipcHandlers = new Map();
  ipcListeners = new Map();
  return {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      ipcListeners.set(channel, handler);
    }),
  };
};

let mockIpcMain: ReturnType<typeof createMockIpcMain>;
let mockNotificationInstance: { show: ReturnType<typeof vi.fn> };
let MockNotification: ReturnType<typeof vi.fn>;
let mockApp: { getVersion: ReturnType<typeof vi.fn> };

// Mock electron before importing
vi.mock('electron', () => {
  mockIpcMain = createMockIpcMain();
  mockNotificationInstance = { show: vi.fn() };
  MockNotification = vi.fn().mockImplementation(() => mockNotificationInstance);
  mockApp = { getVersion: vi.fn().mockReturnValue('1.0.0') };
  return {
    ipcMain: mockIpcMain,
    Notification: MockNotification,
    app: mockApp,
  };
});

describe('IPC Handlers', () => {
  let registerIpcHandlers: typeof import('../../src/main/ipc.js').registerIpcHandlers;
  let electron: typeof import('electron');
  let mockWindowManager: {
    getWindow: ReturnType<typeof vi.fn>;
  };
  let mockConfigStore: {
    getAll: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };
  let mockTrayManager: {
    updateMenu: ReturnType<typeof vi.fn>;
  };
  let mockWindow: {
    minimize: ReturnType<typeof vi.fn>;
    maximize: ReturnType<typeof vi.fn>;
    unmaximize: ReturnType<typeof vi.fn>;
    isMaximized: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Reset handler maps
    ipcHandlers = new Map();
    ipcListeners = new Map();

    // Reset the mocks with fresh maps
    mockIpcMain = createMockIpcMain();
    mockNotificationInstance = { show: vi.fn() };
    MockNotification = vi.fn().mockImplementation(() => mockNotificationInstance);
    mockApp = { getVersion: vi.fn().mockReturnValue('1.0.0') };

    // Import the mocked electron
    electron = await import('electron');

    // Override with our fresh mocks (since resetModules may have created new ones)
    (electron.ipcMain.handle as ReturnType<typeof vi.fn>) = mockIpcMain.handle;
    (electron.ipcMain.on as ReturnType<typeof vi.fn>) = mockIpcMain.on;
    (electron.Notification as unknown) = MockNotification;
    (electron.app.getVersion as ReturnType<typeof vi.fn>) = mockApp.getVersion;

    // Setup mock window
    mockWindow = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn().mockReturnValue(false),
      hide: vi.fn(),
    };

    // Setup mock managers
    mockWindowManager = {
      getWindow: vi.fn().mockReturnValue(mockWindow),
    };

    mockConfigStore = {
      getAll: vi.fn().mockReturnValue({ theme: 'dark' }),
      set: vi.fn(),
    };

    mockTrayManager = {
      updateMenu: vi.fn(),
    };

    // Import module after mocks are set up
    const module = await import('../../src/main/ipc.js');
    registerIpcHandlers = module.registerIpcHandlers;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('window:minimize handler', () => {
    it('should call minimize on the window', async () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('window:minimize');
      expect(handler).toBeDefined();

      // Simulate IPC call
      handler!({} as never);

      expect(mockWindow.minimize).toHaveBeenCalled();
    });
  });

  describe('window:maximize handler', () => {
    it('should call maximize when window is not maximized', async () => {
      mockWindow.isMaximized.mockReturnValue(false);

      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('window:maximize');
      expect(handler).toBeDefined();

      handler!({} as never);

      expect(mockWindow.maximize).toHaveBeenCalled();
    });

    it('should call unmaximize when window is maximized', async () => {
      mockWindow.isMaximized.mockReturnValue(true);

      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('window:maximize');
      handler!({} as never);

      expect(mockWindow.unmaximize).toHaveBeenCalled();
    });
  });

  describe('window:close handler', () => {
    it('should hide window (minimize to tray)', async () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('window:close');
      expect(handler).toBeDefined();

      handler!({} as never);

      expect(mockWindow.hide).toHaveBeenCalled();
    });
  });

  describe('config:get handler', () => {
    it('should return full config', async () => {
      const expectedConfig = { theme: 'dark', fontSize: 14 };
      mockConfigStore.getAll.mockReturnValue(expectedConfig);

      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcHandlers.get('config:get');
      expect(handler).toBeDefined();

      const result = await handler!({} as never);

      expect(mockConfigStore.getAll).toHaveBeenCalled();
      expect(result).toEqual(expectedConfig);
    });
  });

  describe('config:set handler', () => {
    it('should set config value', async () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('config:set');
      expect(handler).toBeDefined();

      handler!({} as never, 'theme', 'light');

      expect(mockConfigStore.set).toHaveBeenCalledWith('theme', 'light');
    });
  });

  describe('notification:show handler', () => {
    it('should create and show a native notification', async () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('notification:show');
      expect(handler).toBeDefined();

      handler!({} as never, 'Test Title', 'Test Body');

      expect(MockNotification).toHaveBeenCalledWith({
        title: 'Test Title',
        body: 'Test Body',
      });
      expect(mockNotificationInstance.show).toHaveBeenCalled();
    });
  });

  describe('sessions:changed handler', () => {
    it('should update tray menu with sessions', async () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcListeners.get('sessions:changed');
      expect(handler).toBeDefined();

      const sessions = [
        { id: 'session-1', name: 'Session 1', status: 'active' },
      ];
      handler!({} as never, sessions);

      expect(mockTrayManager.updateMenu).toHaveBeenCalledWith(sessions);
    });
  });

  describe('app:version handler', () => {
    it('should return app version', async () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      const handler = ipcHandlers.get('app:version');
      expect(handler).toBeDefined();

      const result = await handler!({} as never);

      expect(electron.app.getVersion).toHaveBeenCalled();
      expect(result).toBe('1.0.0');
    });
  });

  describe('IPC channel registration', () => {
    it('should register all required IPC channels', () => {
      registerIpcHandlers(
        mockWindowManager as never,
        mockConfigStore as never,
        mockTrayManager as never
      );

      // One-way messages (ipcMain.on)
      expect(ipcListeners.has('window:minimize')).toBe(true);
      expect(ipcListeners.has('window:maximize')).toBe(true);
      expect(ipcListeners.has('window:close')).toBe(true);
      expect(ipcListeners.has('config:set')).toBe(true);
      expect(ipcListeners.has('notification:show')).toBe(true);
      expect(ipcListeners.has('sessions:changed')).toBe(true);

      // Request-response (ipcMain.handle)
      expect(ipcHandlers.has('config:get')).toBe(true);
      expect(ipcHandlers.has('app:version')).toBe(true);
    });
  });
});
