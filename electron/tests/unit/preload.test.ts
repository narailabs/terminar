import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock ipcRenderer
const mockIpcRenderer = {
  send: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
};

// Mock contextBridge
const mockContextBridge = {
  exposeInMainWorld: vi.fn(),
};

// Mock electron before importing preload module
vi.mock('electron', () => ({
  ipcRenderer: mockIpcRenderer,
  contextBridge: mockContextBridge,
}));

describe('Preload Script', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('contextBridge.exposeInMainWorld', () => {
    it('should expose electronAPI via contextBridge', async () => {
      await import('../../src/preload/index.js');

      expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith(
        'electronAPI',
        expect.any(Object)
      );
    });

    it('should expose electronAPI with all required methods', async () => {
      await import('../../src/preload/index.js');

      const [apiName, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      expect(apiName).toBe('electronAPI');
      expect(api).toHaveProperty('minimize');
      expect(api).toHaveProperty('maximize');
      expect(api).toHaveProperty('close');
      expect(api).toHaveProperty('getConfig');
      expect(api).toHaveProperty('setConfig');
      expect(api).toHaveProperty('showNotification');
      expect(api).toHaveProperty('platform');
      expect(api).toHaveProperty('getVersion');
      expect(api).toHaveProperty('onSessionsChanged');
      expect(api).toHaveProperty('notifySessionsChanged');
    });
  });

  describe('window control methods', () => {
    it('should send window:minimize IPC message when minimize is called', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      api.minimize();

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('window:minimize');
    });

    it('should send window:maximize IPC message when maximize is called', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      api.maximize();

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('window:maximize');
    });

    it('should send window:close IPC message when close is called', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      api.close();

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('window:close');
    });
  });

  describe('config methods', () => {
    it('should invoke config:get IPC and return Promise<Config> from getConfig', async () => {
      const mockConfig = { theme: 'dark', fontSize: 14 };
      mockIpcRenderer.invoke.mockResolvedValue(mockConfig);

      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      const result = await api.getConfig();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('config:get');
      expect(result).toEqual(mockConfig);
    });

    it('should send config:set IPC with key and value when setConfig is called', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      api.setConfig('theme', 'light');

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('config:set', 'theme', 'light');
    });
  });

  describe('showNotification', () => {
    it('should send notification:show IPC with title and body', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      api.showNotification('Test Title', 'Test Body');

      expect(mockIpcRenderer.send).toHaveBeenCalledWith(
        'notification:show',
        'Test Title',
        'Test Body'
      );
    });
  });

  describe('platform property', () => {
    it('should return process.platform', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];

      expect(api.platform).toBe(process.platform);
    });
  });

  describe('getVersion', () => {
    it('should invoke app:getVersion IPC and return Promise<string>', async () => {
      mockIpcRenderer.invoke.mockResolvedValue('1.0.0');

      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      const result = await api.getVersion();

      expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app:getVersion');
      expect(result).toBe('1.0.0');
    });
  });

  describe('session callbacks', () => {
    it('should register callback for sessions:changed event when onSessionsChanged is called', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      const callback = vi.fn();
      api.onSessionsChanged(callback);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith(
        'sessions:changed',
        expect.any(Function)
      );
    });

    it('should call the registered callback when sessions:changed event fires', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      const callback = vi.fn();
      api.onSessionsChanged(callback);

      // Get the registered handler
      const [, handler] = mockIpcRenderer.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'sessions:changed'
      )!;

      // Simulate the event firing
      const mockSessions = [{ id: '1', name: 'Session 1', status: 'active' }];
      handler({}, mockSessions);

      expect(callback).toHaveBeenCalledWith(mockSessions);
    });

    it('should send sessions:changed IPC with sessions when notifySessionsChanged is called', async () => {
      await import('../../src/preload/index.js');

      const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
      const sessions = [
        { id: '1', name: 'Session 1', status: 'active' as const },
        { id: '2', name: 'Session 2', status: 'inactive' as const },
      ];
      api.notifySessionsChanged(sessions);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('sessions:changed', sessions);
    });
  });
});
