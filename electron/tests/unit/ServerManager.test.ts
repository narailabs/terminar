import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Create mock child process
const createMockChildProcess = () => {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.pid = 12345;
  proc.kill = vi.fn().mockReturnValue(true);
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
};

let mockChildProcess = createMockChildProcess();

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn().mockImplementation(() => mockChildProcess),
}));

// Mock electron app for paths
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user-data'),
    isPackaged: false,
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
  },
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

// Mock fetch for health checks
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ServerManager', () => {
  let ServerManager: typeof import('../../src/main/ServerManager.js').ServerManager;
  let spawn: typeof import('child_process').spawn;
  let manager: InstanceType<typeof ServerManager>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockChildProcess = createMockChildProcess();
    mockFetch.mockReset();

    const cp = await import('child_process');
    spawn = cp.spawn;
    (spawn as any).mockImplementation(() => mockChildProcess);

    const mod = await import('../../src/main/ServerManager.js');
    ServerManager = mod.ServerManager;
    manager = new ServerManager();
  });

  afterEach(() => {
    manager.stop();
  });

  describe('start', () => {
    it('should spawn the server process', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const startPromise = manager.start();
      // Simulate server becoming healthy
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('Server started on port 6749'));
      }, 10);

      await startPromise;
      expect(spawn).toHaveBeenCalled();
    });

    it('should pass --no-auth flag by default for local connections', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);

      await startPromise;

      const spawnArgs = (spawn as any).mock.calls[0];
      expect(spawnArgs[1]).toContain('--no-auth');
    });

    it('should emit started event when server is ready', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onStarted = vi.fn();
      manager.on('started', onStarted);

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);

      await startPromise;
      expect(onStarted).toHaveBeenCalled();
    });

    it('should not start if already running', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);
      await startPromise;

      // Second start should not spawn again
      await manager.start();
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('should kill the server process', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);
      await startPromise;

      manager.stop();
      expect(mockChildProcess.kill).toHaveBeenCalled();
    });

    it('should emit stopped event', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onStopped = vi.fn();
      manager.on('stopped', onStopped);

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);
      await startPromise;

      manager.stop();
      // Simulate process exit
      mockChildProcess.emit('close', 0);
      expect(onStopped).toHaveBeenCalled();
    });

    it('should be safe to call when not running', () => {
      expect(() => manager.stop()).not.toThrow();
    });
  });

  describe('status', () => {
    it('should report stopped initially', () => {
      expect(manager.getStatus()).toBe('stopped');
    });

    it('should report starting during startup', () => {
      mockFetch.mockRejectedValue(new Error('not ready'));
      manager.start();
      expect(manager.getStatus()).toBe('starting');
    });

    it('should report running after start', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);
      await startPromise;

      expect(manager.getStatus()).toBe('running');
    });
  });

  describe('server output', () => {
    it('should emit stdout data', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onOutput = vi.fn();
      manager.on('output', onOutput);

      const startPromise = manager.start();
      mockChildProcess.stdout.emit('data', Buffer.from('test output'));
      setTimeout(() => {}, 10);

      await startPromise.catch(() => {}); // may timeout
      expect(onOutput).toHaveBeenCalledWith('test output');
    });

    it('should emit stderr data as error', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onError = vi.fn();
      manager.on('error-output', onError);

      manager.start().catch(() => {}); // start but don't wait
      mockChildProcess.stderr.emit('data', Buffer.from('error message'));

      expect(onError).toHaveBeenCalledWith('error message');
    });
  });

  describe('process crash recovery', () => {
    it('should emit crashed event when process exits unexpectedly', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onCrashed = vi.fn();
      manager.on('crashed', onCrashed);

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);
      await startPromise;

      // Simulate unexpected exit
      mockChildProcess.emit('close', 1);
      expect(onCrashed).toHaveBeenCalledWith(1);
    });

    it('should not emit crashed when stopped gracefully', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const onCrashed = vi.fn();
      manager.on('crashed', onCrashed);

      const startPromise = manager.start();
      setTimeout(() => {
        mockChildProcess.stdout.emit('data', Buffer.from('ready'));
      }, 10);
      await startPromise;

      manager.stop();
      mockChildProcess.emit('close', 0);
      expect(onCrashed).not.toHaveBeenCalled();
    });
  });

  describe('getPort', () => {
    it('should return the configured port', () => {
      expect(manager.getPort()).toBe(6749);
    });
  });

  describe('getWsUrl', () => {
    it('should return the WebSocket URL', () => {
      expect(manager.getWsUrl()).toBe('ws://localhost:6749/ws');
    });
  });

  describe('getHttpUrl', () => {
    it('should return the HTTP URL', () => {
      expect(manager.getHttpUrl()).toBe('http://localhost:6749');
    });
  });
});
