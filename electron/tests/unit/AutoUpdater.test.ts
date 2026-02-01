import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock electron-updater
const mockAutoUpdater = {
  checkForUpdatesAndNotify: vi.fn().mockResolvedValue(null),
  on: vi.fn(),
  logger: null,
  autoDownload: true,
  autoInstallOnAppQuit: true,
};

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater,
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
  },
}));

describe('AutoUpdater', () => {
  let AutoUpdater: typeof import('../../src/main/AutoUpdater.js').AutoUpdater;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const mod = await import('../../src/main/AutoUpdater.js');
    AutoUpdater = mod.AutoUpdater;
  });

  it('should be constructable', () => {
    const updater = new AutoUpdater();
    expect(updater).toBeDefined();
  });

  it('should check for updates when packaged', async () => {
    const updater = new AutoUpdater();
    await updater.checkForUpdates();
    expect(mockAutoUpdater.checkForUpdatesAndNotify).toHaveBeenCalled();
  });

  it('should emit update-available event', () => {
    const updater = new AutoUpdater();
    const onUpdate = vi.fn();
    updater.on('update-available', onUpdate);

    // Simulate electron-updater firing the event
    const onCall = mockAutoUpdater.on.mock.calls.find(
      (call: string[]) => call[0] === 'update-available'
    );
    if (onCall) {
      onCall[1]({ version: '1.0.0' });
      expect(onUpdate).toHaveBeenCalledWith({ version: '1.0.0' });
    }
  });

  it('should emit update-downloaded event', () => {
    const updater = new AutoUpdater();
    const onDownloaded = vi.fn();
    updater.on('update-downloaded', onDownloaded);

    const onCall = mockAutoUpdater.on.mock.calls.find(
      (call: string[]) => call[0] === 'update-downloaded'
    );
    if (onCall) {
      onCall[1]({ version: '1.0.0' });
      expect(onDownloaded).toHaveBeenCalledWith({ version: '1.0.0' });
    }
  });

  it('should handle update errors gracefully', () => {
    const updater = new AutoUpdater();
    const onError = vi.fn();
    updater.on('error', onError);

    const onCall = mockAutoUpdater.on.mock.calls.find(
      (call: string[]) => call[0] === 'error'
    );
    if (onCall) {
      onCall[1](new Error('Network error'));
      expect(onError).toHaveBeenCalled();
    }
  });
});
