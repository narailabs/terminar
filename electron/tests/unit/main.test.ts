import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

const mockInstance = {
  loadFile: vi.fn().mockResolvedValue(undefined),
  loadURL: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

// Use a real class so `new BrowserWindow(...)` works
class MockBrowserWindow {
  loadFile = mockInstance.loadFile;
  loadURL = mockInstance.loadURL;
  on = mockInstance.on;
  static getAllWindows = vi.fn().mockReturnValue([]);
  constructor(public opts: Record<string, unknown>) {}
}

const mockApp = {
  whenReady: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn(),
  on: vi.fn(),
  requestSingleInstanceLock: vi.fn().mockReturnValue(true),
  isPackaged: false,
  name: 'terminar',
};

const mockMenu = {
  buildFromTemplate: vi.fn().mockReturnValue({}),
  setApplicationMenu: vi.fn(),
};

const mockNativeImage = {
  createFromPath: vi.fn().mockReturnValue({}),
};

vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
  Menu: mockMenu,
  nativeImage: mockNativeImage,
}));

describe('Main Process Entry Point', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockApp.requestSingleInstanceLock.mockReturnValue(true);
    mockApp.whenReady.mockResolvedValue(undefined);
    MockBrowserWindow.getAllWindows.mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should call app.whenReady()', async () => {
    await import('../../src/main/index.js');
    expect(mockApp.whenReady).toHaveBeenCalled();
  });

  it('should create window when app is ready', async () => {
    await import('../../src/main/index.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    // loadFile or loadURL should have been called (window was created)
    const loadCalled = mockInstance.loadFile.mock.calls.length > 0 || mockInstance.loadURL.mock.calls.length > 0;
    expect(loadCalled).toBe(true);
  });

  it('should set the application menu', async () => {
    await import('../../src/main/index.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockMenu.setApplicationMenu).toHaveBeenCalled();
  });

  it('should register window-all-closed event handler', async () => {
    await import('../../src/main/index.js');
    expect(mockApp.on).toHaveBeenCalledWith('window-all-closed', expect.any(Function));
  });

  it('should register activate event handler', async () => {
    await import('../../src/main/index.js');
    expect(mockApp.on).toHaveBeenCalledWith('activate', expect.any(Function));
  });

  it('should register second-instance event handler', async () => {
    await import('../../src/main/index.js');
    expect(mockApp.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
  });
});
