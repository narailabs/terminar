import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';

// Mock child_process before importing WslManager
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

import { WslManager } from '../../src/main/WslManager.js';

const mockedExecSync = vi.mocked(child_process.execSync);
const mockedSpawn = vi.mocked(child_process.spawn);

describe('WslManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isWindows', () => {
    it('returns true when platform is win32', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        expect(WslManager.isWindows()).toBe(true);
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      }
    });

    it('returns false when platform is darwin', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      try {
        expect(WslManager.isWindows()).toBe(false);
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      }
    });

    it('returns false when platform is linux', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
      try {
        expect(WslManager.isWindows()).toBe(false);
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      }
    });
  });

  describe('isWslInstalled', () => {
    it('returns true when wsl.exe --status succeeds', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));
      expect(WslManager.isWslInstalled()).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith('wsl.exe --status', {
        stdio: 'pipe',
        timeout: 5000,
      });
    });

    it('returns false when wsl.exe --status throws', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('not found'); });
      expect(WslManager.isWslInstalled()).toBe(false);
    });
  });

  describe('hasDistro', () => {
    it('returns true when distros are listed', () => {
      mockedExecSync.mockReturnValue('Ubuntu\n' as unknown as Buffer);
      expect(WslManager.hasDistro()).toBe(true);
    });

    it('returns true with BOM characters in output', () => {
      mockedExecSync.mockReturnValue('\uFEFFUbuntu\n' as unknown as Buffer);
      expect(WslManager.hasDistro()).toBe(true);
    });

    it('returns false when output is empty', () => {
      mockedExecSync.mockReturnValue('\n' as unknown as Buffer);
      expect(WslManager.hasDistro()).toBe(false);
    });

    it('returns false when output is only BOM and whitespace', () => {
      mockedExecSync.mockReturnValue('\uFEFF\n' as unknown as Buffer);
      expect(WslManager.hasDistro()).toBe(false);
    });

    it('returns false when command throws', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('fail'); });
      expect(WslManager.hasDistro()).toBe(false);
    });
  });

  describe('getDefaultDistro', () => {
    it('returns first distro name', () => {
      mockedExecSync.mockReturnValue('Ubuntu\nDebian\n' as unknown as Buffer);
      expect(WslManager.getDefaultDistro()).toBe('Ubuntu');
    });

    it('strips BOM from output', () => {
      mockedExecSync.mockReturnValue('\uFEFFUbuntu-22.04\n' as unknown as Buffer);
      expect(WslManager.getDefaultDistro()).toBe('Ubuntu-22.04');
    });

    it('returns null when no distros', () => {
      mockedExecSync.mockReturnValue('\n' as unknown as Buffer);
      expect(WslManager.getDefaultDistro()).toBeNull();
    });

    it('returns null when command throws', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('fail'); });
      expect(WslManager.getDefaultDistro()).toBeNull();
    });
  });

  describe('spawnServer', () => {
    it('spawns wsl.exe with server path and --stdio flag', () => {
      const mockProcess = { pid: 1234 } as unknown as child_process.ChildProcess;
      mockedSpawn.mockReturnValue(mockProcess);

      const result = WslManager.spawnServer('/home/user/.terminar/terminar-server');
      expect(mockedSpawn).toHaveBeenCalledWith(
        'wsl.exe',
        ['/home/user/.terminar/terminar-server', '--stdio'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect(result).toBe(mockProcess);
    });
  });

  describe('isServerInstalled', () => {
    it('returns true when test -x succeeds', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));
      expect(WslManager.isServerInstalled('~/.terminar/terminar-server')).toBe(true);
      expect(mockedExecSync).toHaveBeenCalledWith(
        "wsl.exe test -x '~/.terminar/terminar-server'",
        { stdio: 'pipe', timeout: 5000 },
      );
    });

    it('returns false when test -x fails', () => {
      mockedExecSync.mockImplementation(() => { throw new Error('not executable'); });
      expect(WslManager.isServerInstalled('~/.terminar/terminar-server')).toBe(false);
    });
  });

  describe('installServerBinary', () => {
    it('converts path, creates directory, copies and chmods', async () => {
      mockedExecSync.mockReset();
      mockedExecSync
        // wslpath call
        .mockReturnValueOnce('/mnt/c/Users/user/terminar-server\n' as unknown as Buffer)
        // mkdir -p
        .mockReturnValueOnce(Buffer.from(''))
        // cp
        .mockReturnValueOnce(Buffer.from(''))
        // chmod
        .mockReturnValueOnce(Buffer.from(''));

      await WslManager.installServerBinary(
        'C:\\Users\\user\\terminar-server',
        '/home/user/.terminar/terminar-server',
      );

      expect(mockedExecSync).toHaveBeenCalledTimes(4);

      // Verify wslpath conversion
      expect(mockedExecSync).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('wsl.exe wslpath'),
        expect.objectContaining({ encoding: 'utf-8' }),
      );

      // Verify mkdir
      expect(mockedExecSync).toHaveBeenNthCalledWith(
        2,
        "wsl.exe mkdir -p '/home/user/.terminar'",
        expect.objectContaining({ stdio: 'pipe' }),
      );

      // Verify cp
      expect(mockedExecSync).toHaveBeenNthCalledWith(
        3,
        "wsl.exe cp '/mnt/c/Users/user/terminar-server' '/home/user/.terminar/terminar-server'",
        expect.objectContaining({ stdio: 'pipe' }),
      );

      // Verify chmod
      expect(mockedExecSync).toHaveBeenNthCalledWith(
        4,
        "wsl.exe chmod +x '/home/user/.terminar/terminar-server'",
        expect.objectContaining({ stdio: 'pipe' }),
      );
    });

    it('handles paths with single quotes', async () => {
      mockedExecSync.mockReset();
      mockedExecSync
        .mockReturnValueOnce("/mnt/c/Users/user's/server\n" as unknown as Buffer)
        .mockReturnValueOnce(Buffer.from(''))
        .mockReturnValueOnce(Buffer.from(''))
        .mockReturnValueOnce(Buffer.from(''));

      await WslManager.installServerBinary(
        "C:\\Users\\user's\\server",
        '/home/user/.terminar/terminar-server',
      );

      // The wslpath call should escape the single quote
      const wslpathCall = mockedExecSync.mock.calls[0]![0] as string;
      expect(wslpathCall).toContain("'\\''");
    });
  });
});
