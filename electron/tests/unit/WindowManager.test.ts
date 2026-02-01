import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Create mock BrowserWindow instance
const createMockBrowserWindowInstance = () => ({
  loadFile: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  focus: vi.fn(),
  isVisible: vi.fn().mockReturnValue(false),
});

// Mock electron before importing WindowManager
vi.mock('electron', () => {
  const mockInstance = createMockBrowserWindowInstance();
  const MockBrowserWindow = vi.fn().mockImplementation(() => mockInstance);
  return {
    BrowserWindow: MockBrowserWindow,
  };
});

describe('WindowManager', () => {
  let WindowManager: typeof import('../../src/main/WindowManager.js').WindowManager;
  let electron: typeof import('electron');
  let mockBrowserWindowInstance: ReturnType<typeof createMockBrowserWindowInstance>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Import the mocked electron
    electron = await import('electron');

    // Setup fresh mock instance
    mockBrowserWindowInstance = createMockBrowserWindowInstance();
    (electron.BrowserWindow as unknown as Mock).mockImplementation(() => mockBrowserWindowInstance);

    // Import WindowManager after mocks are set up
    const module = await import('../../src/main/WindowManager.js');
    WindowManager = module.WindowManager;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createMainWindow', () => {
    it('should create BrowserWindow with default size 1200x800', () => {
      const manager = new WindowManager();
      manager.createMainWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          width: 1200,
          height: 800,
        })
      );
    });

    it('should create BrowserWindow with minimum size 800x600', () => {
      const manager = new WindowManager();
      manager.createMainWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          minWidth: 800,
          minHeight: 600,
        })
      );
    });

    it('should create BrowserWindow with contextIsolation true', () => {
      const manager = new WindowManager();
      manager.createMainWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            contextIsolation: true,
          }),
        })
      );
    });

    it('should create BrowserWindow with nodeIntegration false', () => {
      const manager = new WindowManager();
      manager.createMainWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            nodeIntegration: false,
          }),
        })
      );
    });

    it('should create BrowserWindow with sandbox true', () => {
      const manager = new WindowManager();
      manager.createMainWindow();

      expect(electron.BrowserWindow).toHaveBeenCalledWith(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            sandbox: true,
          }),
        })
      );
    });

    it('should return the created BrowserWindow', () => {
      const manager = new WindowManager();
      const window = manager.createMainWindow();

      expect(window).toBe(mockBrowserWindowInstance);
    });
  });

  describe('showWindow', () => {
    it('should call show on the window', () => {
      const manager = new WindowManager();
      manager.createMainWindow();
      manager.showWindow();

      expect(mockBrowserWindowInstance.show).toHaveBeenCalled();
    });

    it('should call focus on the window', () => {
      const manager = new WindowManager();
      manager.createMainWindow();
      manager.showWindow();

      expect(mockBrowserWindowInstance.focus).toHaveBeenCalled();
    });

    it('should do nothing if no window exists', () => {
      const manager = new WindowManager();
      // Don't create window
      expect(() => manager.showWindow()).not.toThrow();
    });
  });

  describe('hideWindow', () => {
    it('should call hide on the window', () => {
      const manager = new WindowManager();
      manager.createMainWindow();
      manager.hideWindow();

      expect(mockBrowserWindowInstance.hide).toHaveBeenCalled();
    });

    it('should do nothing if no window exists', () => {
      const manager = new WindowManager();
      // Don't create window
      expect(() => manager.hideWindow()).not.toThrow();
    });
  });

  describe('toggleWindow', () => {
    it('should show window when it is currently hidden', () => {
      const manager = new WindowManager();
      manager.createMainWindow();
      mockBrowserWindowInstance.isVisible.mockReturnValue(false);

      manager.toggleWindow();

      expect(mockBrowserWindowInstance.show).toHaveBeenCalled();
      expect(mockBrowserWindowInstance.focus).toHaveBeenCalled();
    });

    it('should hide window when it is currently visible', () => {
      const manager = new WindowManager();
      manager.createMainWindow();
      mockBrowserWindowInstance.isVisible.mockReturnValue(true);

      manager.toggleWindow();

      expect(mockBrowserWindowInstance.hide).toHaveBeenCalled();
    });

    it('should do nothing if no window exists', () => {
      const manager = new WindowManager();
      // Don't create window
      expect(() => manager.toggleWindow()).not.toThrow();
    });
  });

  describe('getWindow', () => {
    it('should return the window after creation', () => {
      const manager = new WindowManager();
      manager.createMainWindow();

      const window = manager.getWindow();

      expect(window).toBe(mockBrowserWindowInstance);
    });

    it('should return null before window is created', () => {
      const manager = new WindowManager();

      const window = manager.getWindow();

      expect(window).toBeNull();
    });
  });
});
