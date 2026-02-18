import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockIpcRenderer = {
  send: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
};

const mockContextBridge = {
  exposeInMainWorld: vi.fn(),
};

vi.mock('electron', () => ({
  ipcRenderer: mockIpcRenderer,
  contextBridge: mockContextBridge,
}));

describe('Preload Script', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should expose electronAPI via contextBridge', async () => {
    await import('../../src/preload/index.js');

    expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      'electronAPI',
      expect.any(Object)
    );
  });

  it('should expose platform property', async () => {
    await import('../../src/preload/index.js');

    const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
    expect(api).toHaveProperty('platform');
    expect(api.platform).toBe(process.platform);
  });

  it('should expose getVersion method that invokes IPC', async () => {
    mockIpcRenderer.invoke.mockResolvedValue('1.0.0');
    await import('../../src/preload/index.js');

    const [, api] = mockContextBridge.exposeInMainWorld.mock.calls[0];
    const result = await api.getVersion();

    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith('app:version');
    expect(result).toBe('1.0.0');
  });
});
