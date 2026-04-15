import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// Use vi.hoisted so these refs exist when the hoisted vi.mock factory runs.
const { handlers, shellMock, clipboardMock, dialogMock, appMock } = vi.hoisted(() => {
  return {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    shellMock: {
      openPath: vi.fn(async (_: string) => ''),
      openExternal: vi.fn(async (_: string) => undefined),
    },
    clipboardMock: { writeText: vi.fn() },
    dialogMock: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
    appMock: { getVersion: vi.fn(() => '0.0.0-test') },
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  dialog: dialogMock,
  app: appMock,
  clipboard: clipboardMock,
  shell: shellMock,
}));

// Imported AFTER the vi.mock call above (hoisted by Vitest).
import { registerIpcHandlers } from '../../src/main/ipc.js';

async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`handler not registered: ${channel}`);
  return (await fn({}, ...args)) as T;
}

describe('ipc.tray:open-path', () => {
  beforeEach(() => {
    handlers.clear();
    shellMock.openPath.mockReset();
    shellMock.openPath.mockResolvedValue('');
    const configStore = { load: () => ({}), save: vi.fn() };
    const healthPoller = { latestHealth: null };
    const windowManager = { closeWindowById: vi.fn() };
    registerIpcHandlers(
      configStore as never,
      healthPoller as never,
      windowManager as never,
    );
  });

  it('rejects non-string input', async () => {
    expect(await call('tray:open-path', 123)).toBe('invalid path');
    expect(await call('tray:open-path', null)).toBe('invalid path');
    expect(await call('tray:open-path', undefined)).toBe('invalid path');
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  it('rejects empty string', async () => {
    expect(await call('tray:open-path', '')).toBe('invalid path');
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  it('rejects oversized path', async () => {
    expect(await call('tray:open-path', '/' + 'a'.repeat(5000))).toBe('invalid path');
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  it('rejects null-byte path', async () => {
    expect(await call('tray:open-path', '/etc/pass\0wd')).toBe('invalid path');
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  it('rejects relative path', async () => {
    expect(await call('tray:open-path', 'relative/foo.md')).toBe('invalid path');
    expect(shellMock.openPath).not.toHaveBeenCalled();
  });

  it('accepts absolute path and calls shell.openPath', async () => {
    shellMock.openPath.mockResolvedValueOnce('');
    const result = await call('tray:open-path', '/tmp/foo.md');
    expect(shellMock.openPath).toHaveBeenCalledWith('/tmp/foo.md');
    expect(result).toBeNull();
  });

  it('expands ~/ before calling shell.openPath', async () => {
    shellMock.openPath.mockResolvedValueOnce('');
    await call('tray:open-path', '~/Notes/plan.md');
    expect(shellMock.openPath).toHaveBeenCalledWith(join(homedir(), 'Notes/plan.md'));
  });

  it('accepts bare ~ as homedir', async () => {
    shellMock.openPath.mockResolvedValueOnce('');
    await call('tray:open-path', '~');
    expect(shellMock.openPath).toHaveBeenCalledWith(homedir());
  });

  it('propagates shell.openPath error string', async () => {
    shellMock.openPath.mockResolvedValueOnce('No app associated');
    const result = await call('tray:open-path', '/tmp/foo.md');
    expect(result).toBe('No app associated');
  });
});

describe('ipc.tray:stat-path', () => {
  let tmpDir: string;

  beforeEach(() => {
    handlers.clear();
    const configStore = { load: () => ({}), save: vi.fn() };
    const healthPoller = { latestHealth: null };
    const windowManager = { closeWindowById: vi.fn() };
    registerIpcHandlers(
      configStore as never,
      healthPoller as never,
      windowManager as never,
    );
    tmpDir = mkdtempSync(join(tmpdir(), 'terminar-stat-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns exists:false for non-string input', async () => {
    expect(await call('tray:stat-path', 123)).toEqual({ exists: false, isFile: false });
    expect(await call('tray:stat-path', null)).toEqual({ exists: false, isFile: false });
  });

  it('returns exists:false for empty string', async () => {
    expect(await call('tray:stat-path', '')).toEqual({ exists: false, isFile: false });
  });

  it('returns exists:false for null-byte path', async () => {
    expect(await call('tray:stat-path', '/tmp/x\0y')).toEqual({ exists: false, isFile: false });
  });

  it('returns exists:false for relative path', async () => {
    expect(await call('tray:stat-path', 'relative/foo.md')).toEqual({ exists: false, isFile: false });
  });

  it('returns exists:true, isFile:true for an existing file', async () => {
    const filepath = join(tmpDir, 'hello.md');
    writeFileSync(filepath, '# hi');
    expect(await call('tray:stat-path', filepath)).toEqual({ exists: true, isFile: true });
  });

  it('returns exists:true, isFile:false for a directory', async () => {
    const result = await call<{ exists: boolean; isFile: boolean }>('tray:stat-path', tmpDir);
    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(false);
  });

  it('returns exists:false for a missing file', async () => {
    const missing = join(tmpDir, '__does_not_exist__.md');
    expect(await call('tray:stat-path', missing)).toEqual({ exists: false, isFile: false });
  });

  it('expands ~/ before stat', async () => {
    // Home directory exists and is a dir — so ~/ should stat as exists:true, isFile:false.
    const result = await call<{ exists: boolean; isFile: boolean }>('tray:stat-path', '~');
    expect(result.exists).toBe(true);
    expect(result.isFile).toBe(false);
  });
});
