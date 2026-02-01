import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Create mock factories that can be reused after resetModules
const createMockBrowserWindow = () => {
  const mockInstance = {
    loadFile: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  const MockBrowserWindow = vi.fn().mockImplementation(() => mockInstance);
  (MockBrowserWindow as unknown as { getAllWindows: Mock }).getAllWindows = vi.fn().mockReturnValue([]);
  return { MockBrowserWindow, mockInstance };
};

const createMockApp = () => ({
  whenReady: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn(),
  on: vi.fn(),
  requestSingleInstanceLock: vi.fn().mockReturnValue(true),
});

// Mock electron before importing main module
vi.mock('electron', () => {
  const { MockBrowserWindow } = createMockBrowserWindow();
  return {
    app: createMockApp(),
    BrowserWindow: MockBrowserWindow,
  };
});

// Mock ServerManager
vi.mock('../../src/main/ServerManager.js', () => ({
  ServerManager: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    getPort: vi.fn().mockReturnValue(3000),
    on: vi.fn(),
  })),
}));

// Mock AutoUpdater
vi.mock('../../src/main/AutoUpdater.js', () => {
  return {
    AutoUpdater: function() {
      return {
        checkForUpdates: () => Promise.resolve(undefined),
        on: () => {},
      };
    },
  };
});

describe('Main Process Entry Point', () => {
  let electron: typeof import('electron');
  let createWindow: () => void;
  let mockBrowserWindowInstance: {
    loadFile: Mock;
    on: Mock;
  };

  async function setupMocks() {
    // Import the mocked electron
    electron = await import('electron');

    // Setup fresh mock instance
    mockBrowserWindowInstance = {
      loadFile: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    // Configure the mocks
    (electron.BrowserWindow as unknown as Mock).mockImplementation(() => mockBrowserWindowInstance);
    (electron.BrowserWindow as unknown as { getAllWindows: Mock }).getAllWindows = vi.fn().mockReturnValue([]);
    (electron.app.whenReady as Mock).mockResolvedValue(undefined);
    (electron.app as any).requestSingleInstanceLock = vi.fn().mockReturnValue(true);
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await setupMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createWindow function', () => {
    it('should create BrowserWindow with context isolation enabled', async () => {
      const mainModule = await import('../../src/main/index.js');
      createWindow = mainModule.createWindow;

      createWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            contextIsolation: true,
          }),
        })
      );
    });

    it('should create BrowserWindow with node integration disabled', async () => {
      const mainModule = await import('../../src/main/index.js');
      createWindow = mainModule.createWindow;

      createWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            nodeIntegration: false,
          }),
        })
      );
    });

    it('should create BrowserWindow with sandbox enabled', async () => {
      const mainModule = await import('../../src/main/index.js');
      createWindow = mainModule.createWindow;

      createWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            sandbox: true,
          }),
        })
      );
    });

    it('should load renderer/index.html', async () => {
      const mainModule = await import('../../src/main/index.js');
      createWindow = mainModule.createWindow;

      createWindow();

      expect(mockBrowserWindowInstance.loadFile).toHaveBeenCalledWith(
        expect.stringMatching(/renderer[/\\]index\.html$/)
      );
    });
  });

  describe('app ready handler', () => {
    it('should call app.whenReady()', async () => {
      await import('../../src/main/index.js');

      expect(electron.app.whenReady).toHaveBeenCalled();
    });

    it('should create window when app is ready', async () => {
      // Setup whenReady to resolve and trigger callback
      (electron.app.whenReady as Mock).mockImplementation(() => Promise.resolve());

      await import('../../src/main/index.js');

      // Wait for promise chain to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(electron.BrowserWindow).toHaveBeenCalled();
    });
  });

  describe('window-all-closed event', () => {
    it('should register window-all-closed event handler', async () => {
      await import('../../src/main/index.js');

      expect(electron.app.on).toHaveBeenCalledWith(
        'window-all-closed',
        expect.any(Function)
      );
    });

    it('should quit app on window-all-closed when not on macOS', async () => {
      // Mock platform as Windows
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });

      try {
        await import('../../src/main/index.js');

        // Get the window-all-closed callback
        const onCall = (electron.app.on as Mock).mock.calls.find(
          call => call[0] === 'window-all-closed'
        );
        expect(onCall).toBeDefined();

        const windowAllClosedCallback = onCall![1] as () => void;
        windowAllClosedCallback();

        expect(electron.app.quit).toHaveBeenCalled();
      } finally {
        // Restore platform
        Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
      }
    });

    it('should not quit app on window-all-closed when on macOS', async () => {
      // Reset modules and re-setup mocks
      vi.resetModules();
      await setupMocks();

      // Mock platform as macOS
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

      try {
        await import('../../src/main/index.js');

        // Get the window-all-closed callback
        const onCall = (electron.app.on as Mock).mock.calls.find(
          call => call[0] === 'window-all-closed'
        );
        expect(onCall).toBeDefined();

        const windowAllClosedCallback = onCall![1] as () => void;
        windowAllClosedCallback();

        expect(electron.app.quit).not.toHaveBeenCalled();
      } finally {
        // Restore platform
        Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
      }
    });
  });

  describe('activate event', () => {
    it('should register activate event handler', async () => {
      await import('../../src/main/index.js');

      expect(electron.app.on).toHaveBeenCalledWith(
        'activate',
        expect.any(Function)
      );
    });

    it('should create window on activate when no windows exist', async () => {
      // Mock getAllWindows to return empty array
      (electron.BrowserWindow as unknown as { getAllWindows: Mock }).getAllWindows.mockReturnValue([]);

      await import('../../src/main/index.js');

      // Get the activate callback
      const onCall = (electron.app.on as Mock).mock.calls.find(
        call => call[0] === 'activate'
      );
      expect(onCall).toBeDefined();

      // Clear previous calls to BrowserWindow
      (electron.BrowserWindow as unknown as Mock).mockClear();

      const activateCallback = onCall![1] as () => void;
      activateCallback();

      expect(electron.BrowserWindow).toHaveBeenCalled();
    });

    it('should not create window on activate when windows exist', async () => {
      // Reset modules and re-setup mocks
      vi.resetModules();
      await setupMocks();

      // Mock getAllWindows to return one window
      (electron.BrowserWindow as unknown as { getAllWindows: Mock }).getAllWindows.mockReturnValue([{}]);

      await import('../../src/main/index.js');

      // Get the activate callback
      const onCall = (electron.app.on as Mock).mock.calls.find(
        call => call[0] === 'activate'
      );
      expect(onCall).toBeDefined();

      // Clear previous calls to BrowserWindow
      (electron.BrowserWindow as unknown as Mock).mockClear();

      const activateCallback = onCall![1] as () => void;
      activateCallback();

      expect(electron.BrowserWindow).not.toHaveBeenCalled();
    });
  });
});
