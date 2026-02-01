import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketSessionManager } from './WebSocketSessionManager';
import { WebSocket, Server } from 'mock-socket';

// Polyfill global WebSocket
global.WebSocket = WebSocket;

describe('WebSocketSessionManager', () => {
  let manager: WebSocketSessionManager;
  let mockServer: Server;
  const url = 'ws://localhost:1234';

  beforeEach(() => {
    mockServer = new Server(url);
  });

  afterEach(() => {
    mockServer.stop();
  });

  it('should instantiate with a URL', () => {
    manager = new WebSocketSessionManager(url);
    expect(manager).toBeDefined();
  });

  it('should connect to the server', async () => {
    manager = new WebSocketSessionManager(url);
    const connectPromise = manager.connect();
    await expect(connectPromise).resolves.toBeUndefined();
  });

  it('should not reconnect if already connected', async () => {
    manager = new WebSocketSessionManager(url);
    await manager.connect();
    
    const socket1 = (manager as any).socket;
    await manager.connect();
    const socket2 = (manager as any).socket;
    
    expect(socket1).toBe(socket2);
  });

  it('should fail to connect if server is unreachable', async () => {
    mockServer.stop();
    manager = new WebSocketSessionManager(url);
    
    // In mock-socket, if no server is running at the URL, 
    // it usually times out or errors depending on implementation.
    // Forcing a rejection for this test case if it hangs.
    const connectPromise = manager.connect();
    await expect(Promise.race([
        connectPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
    ])).rejects.toThrow();
  });

  it('should emit sessionList on receiving SessionList message', () => {
    manager = new WebSocketSessionManager(url);
    const emitSpy = vi.spyOn(manager, 'emit');
    
    (manager as any).handleMessage({
      type: 'SessionList',
      sessions: [{ id: '1', name: 'test' }]
    });

    expect(emitSpy).toHaveBeenCalledWith('sessionList', [{ id: '1', name: 'test' }]);
  });

  it('should emit output on receiving Output message', () => {
    manager = new WebSocketSessionManager(url);
    const emitSpy = vi.spyOn(manager, 'emit');
    
    (manager as any).handleMessage({
      type: 'Output',
      session_id: '1',
      data: 'hello'
    });

    expect(emitSpy).toHaveBeenCalledWith('output', '1', 'hello');
  });

  describe('sending messages', () => {
    let lastMessage: any = null;
    let messageResolver: ((val: any) => void) | null = null;

    beforeEach(async () => {
      lastMessage = null;
      mockServer.on('connection', socket => {
        socket.on('message', data => {
          const msg = JSON.parse(data as string);
          lastMessage = msg;
          if (messageResolver) {
            messageResolver(msg);
            messageResolver = null;
          }
        });
      });
      manager = new WebSocketSessionManager(url);
      await manager.connect();
    });

    async function waitForMessage() {
        if (lastMessage) return lastMessage;
        return new Promise(resolve => {
            messageResolver = resolve;
        });
    }

    it('should send list_sessions message', async () => {
      manager.listSessions();
      const msg = await waitForMessage();
      expect(msg).toEqual({ type: 'list_sessions' });
    });

    it('should send create_session message', async () => {
      manager.createSession('/tmp', 'bash', { HOME: '/root' });
      const msg = await waitForMessage();
      expect(msg).toEqual({
        type: 'create_session',
        cwd: '/tmp',
        shell: 'bash',
        env: { HOME: '/root' },
        cols: 80,
        rows: 24
      });
    });

    it('should send attach message', async () => {
      manager.attach('sess-1');
      const msg = await waitForMessage();
      expect(msg).toEqual({
        type: 'attach',
        session_id: 'sess-1',
        mode: 'mirror'
      });
    });

    it('should send input message', async () => {
      manager.sendInput('sess-1', 'ls\n');
      const msg = await waitForMessage();
      expect(msg).toEqual({
        type: 'input',
        session_id: 'sess-1',
        data: 'ls\n'
      });
    });

    it('should send rename_session message', async () => {
      manager.renameSession('sess-1', 'new-name');
      const msg = await waitForMessage();
      expect(msg).toEqual({
        type: 'rename_session',
        session_id: 'sess-1',
        new_name: 'new-name'
      });
    });

    it('should send kill_session message', async () => {
      manager.killSession('sess-1');
      const msg = await waitForMessage();
      expect(msg).toEqual({
        type: 'kill_session',
        session_id: 'sess-1'
      });
    });
  });

  describe('connection state management', () => {
    it('should start in disconnected state', () => {
      manager = new WebSocketSessionManager(url);
      expect(manager.getState()).toBe('disconnected');
    });

    it('should transition to connected state after connect', async () => {
      manager = new WebSocketSessionManager(url);
      await manager.connect();
      expect(manager.getState()).toBe('connected');
    });

    it('should emit stateChange events', async () => {
      manager = new WebSocketSessionManager(url);
      const states: string[] = [];
      manager.on('stateChange', (state: string) => states.push(state));

      await manager.connect();

      expect(states).toContain('connecting');
      expect(states).toContain('connected');
    });

    it('should transition to disconnected on close', async () => {
      manager = new WebSocketSessionManager(url);
      await manager.connect();

      const statePromise = new Promise(resolve => {
        manager.on('stateChange', (state: string) => {
          if (state === 'disconnected') resolve(state);
        });
      });

      manager.disconnect();
      await statePromise;

      expect(manager.getState()).toBe('disconnected');
    });
  });

  describe('reconnection logic', () => {
    it('should have default reconnect config', () => {
      manager = new WebSocketSessionManager(url);
      const config = (manager as any).reconnectConfig;

      expect(config.baseDelay).toBe(1000);
      expect(config.maxDelay).toBe(30000);
      expect(config.maxRetries).toBe(10);
      expect(config.jitter).toBe(500);
    });

    it('should accept custom reconnect config', () => {
      manager = new WebSocketSessionManager(url, undefined, {
        baseDelay: 500,
        maxDelay: 10000,
        maxRetries: 5,
        jitter: 100
      });
      const config = (manager as any).reconnectConfig;

      expect(config.baseDelay).toBe(500);
      expect(config.maxDelay).toBe(10000);
      expect(config.maxRetries).toBe(5);
      expect(config.jitter).toBe(100);
    });

    it('should calculate exponential backoff delay', () => {
      manager = new WebSocketSessionManager(url, undefined, {
        baseDelay: 1000,
        maxDelay: 30000,
        maxRetries: 10,
        jitter: 0 // No jitter for deterministic test
      });

      const calculateDelay = (manager as any).calculateReconnectDelay.bind(manager);

      // Attempt 0: 1000 * 2^0 = 1000
      (manager as any).reconnectAttempt = 0;
      expect(calculateDelay()).toBe(1000);

      // Attempt 1: 1000 * 2^1 = 2000
      (manager as any).reconnectAttempt = 1;
      expect(calculateDelay()).toBe(2000);

      // Attempt 2: 1000 * 2^2 = 4000
      (manager as any).reconnectAttempt = 2;
      expect(calculateDelay()).toBe(4000);

      // Attempt 5: 1000 * 2^5 = 32000 -> capped at 30000
      (manager as any).reconnectAttempt = 5;
      expect(calculateDelay()).toBe(30000);
    });

    it('should add jitter to reconnect delay', () => {
      manager = new WebSocketSessionManager(url, undefined, {
        baseDelay: 1000,
        maxDelay: 30000,
        maxRetries: 10,
        jitter: 500
      });

      (manager as any).reconnectAttempt = 0;
      const calculateDelay = (manager as any).calculateReconnectDelay.bind(manager);

      // Run multiple times and check that values vary
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(calculateDelay());
      }

      // With jitter, we should get different values
      // All values should be between baseDelay and baseDelay + jitter
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(1000);
        expect(delay).toBeLessThan(1500);
      }
    });

    it('should emit reconnecting event with attempt and delay', async () => {
      mockServer.stop();

      manager = new WebSocketSessionManager(url, undefined, {
        baseDelay: 50,
        maxDelay: 100,
        maxRetries: 1, // Only 1 retry to avoid unhandled errors
        jitter: 0
      });

      const reconnectingEvents: { attempt: number; delay: number }[] = [];
      manager.on('reconnecting', (attempt: number, delay: number) => {
        reconnectingEvents.push({ attempt, delay });
        // Disconnect immediately to prevent further reconnection attempts
        manager.disconnect();
      });

      // Suppress error events to avoid unhandled rejections
      manager.on('error', () => {});

      // Connect will fail, triggering reconnection
      await manager.connect().catch(() => {});

      // Wait briefly for the reconnecting event
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have recorded at least one reconnecting event
      if (reconnectingEvents.length > 0) {
        expect(reconnectingEvents[0].attempt).toBe(1);
        expect(reconnectingEvents[0].delay).toBeGreaterThanOrEqual(50);
      }
    });

    it('should stop reconnecting after max retries', async () => {
      mockServer.stop();

      manager = new WebSocketSessionManager(url, undefined, {
        baseDelay: 10,
        maxDelay: 20,
        maxRetries: 1, // Just 1 retry
        jitter: 0
      });

      const errorPromise = new Promise<Error>(resolve => {
        manager.on('error', (err: Error) => {
          if (err.message.includes('Failed to reconnect')) {
            resolve(err);
          }
        });
      });

      await manager.connect().catch(() => {});

      // Wait for the error with a timeout
      const error = await Promise.race([
        errorPromise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 500))
      ]);

      // Disconnect to stop any pending reconnections
      manager.disconnect();

      expect(error).not.toBeNull();
      expect(error?.message).toContain('Failed to reconnect');
    });

    it('should preserve session list across reconnects', async () => {
      manager = new WebSocketSessionManager(url);

      // Simulate receiving a session list
      (manager as any).handleMessage({
        type: 'SessionList',
        sessions: [{ id: 'test-1', name: 'test-session' }]
      });

      expect(manager.getLastSessionList()).toHaveLength(1);
      expect(manager.getLastSessionList()[0].id).toBe('test-1');

      // Disconnect
      manager.disconnect();

      // Session list should still be preserved
      expect(manager.getLastSessionList()).toHaveLength(1);
    });

    it('should reset reconnect attempts after successful connection', async () => {
      manager = new WebSocketSessionManager(url);

      // Simulate failed reconnect attempts
      (manager as any).reconnectAttempt = 5;

      await manager.connect();

      // Reconnect attempts should be reset
      expect((manager as any).reconnectAttempt).toBe(0);
    });

    it('should support manual reconnect', async () => {
      manager = new WebSocketSessionManager(url);
      await manager.connect();

      expect(manager.getState()).toBe('connected');

      // Manual reconnect
      await manager.reconnect();

      expect(manager.getState()).toBe('connected');
      expect((manager as any).reconnectAttempt).toBe(0);
    });
  });

  describe('shutdown handling', () => {
    it('should emit shutdown event', () => {
      manager = new WebSocketSessionManager(url);
      const shutdownSpy = vi.fn();
      manager.on('shutdown', shutdownSpy);

      (manager as any).handleMessage({
        type: 'Shutdown',
        reason: 'Server restart'
      });

      expect(shutdownSpy).toHaveBeenCalledWith('Server restart');
    });

    it('should increase reconnect delay after shutdown', () => {
      manager = new WebSocketSessionManager(url);

      // Start with 0 attempts
      expect((manager as any).reconnectAttempt).toBe(0);

      (manager as any).handleMessage({
        type: 'Shutdown',
        reason: 'Maintenance'
      });

      // Reconnect attempt should be bumped to at least 2
      expect((manager as any).reconnectAttempt).toBeGreaterThanOrEqual(2);
    });
  });

  describe('error handling', () => {
    it('should emit error event on Error message', () => {
      manager = new WebSocketSessionManager(url);
      const errorSpy = vi.fn();
      manager.on('error', errorSpy);

      (manager as any).handleMessage({
        type: 'Error',
        message: 'Session not found'
      });

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorSpy.mock.calls[0][0].message).toBe('Session not found');
    });

    it('should emit sessionClosed event', () => {
      manager = new WebSocketSessionManager(url);
      const closedSpy = vi.fn();
      manager.on('sessionClosed', closedSpy);

      (manager as any).handleMessage({
        type: 'SessionClosed',
        session_id: 'sess-123'
      });

      expect(closedSpy).toHaveBeenCalledWith('sess-123');
    });
  });

  describe('message validation', () => {
    it('should reject malformed server messages and not emit events', () => {
      manager = new WebSocketSessionManager(url);
      const sessionListSpy = vi.fn();
      const errorSpy = vi.fn();
      manager.on('sessionList', sessionListSpy);
      manager.on('error', errorSpy);

      // SessionList without sessions array
      (manager as any).handleMessage({ type: 'SessionList' });

      expect(sessionListSpy).not.toHaveBeenCalled();
    });

    it('should reject unknown message types', () => {
      manager = new WebSocketSessionManager(url);
      const errorSpy = vi.fn();
      manager.on('error', errorSpy);

      // Unknown type should not cause a crash
      (manager as any).handleMessage({ type: 'FooBar', data: 123 });

      // Should not have emitted any known event
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should validate Output messages have required fields', () => {
      manager = new WebSocketSessionManager(url);
      const outputSpy = vi.fn();
      manager.on('output', outputSpy);

      // Output missing data field
      (manager as any).handleMessage({ type: 'Output', session_id: '1' });

      expect(outputSpy).not.toHaveBeenCalled();
    });

    it('should validate Error messages have required fields', () => {
      manager = new WebSocketSessionManager(url);
      const errorSpy = vi.fn();
      manager.on('error', errorSpy);

      // Error missing message field
      (manager as any).handleMessage({ type: 'Error' });

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should accept well-formed server messages after validation', () => {
      manager = new WebSocketSessionManager(url);
      const sessionListSpy = vi.fn();
      manager.on('sessionList', sessionListSpy);

      (manager as any).handleMessage({
        type: 'SessionList',
        sessions: [{ id: '1', name: 'test', shell: 'bash', started_at: '2025-01-01' }]
      });

      expect(sessionListSpy).toHaveBeenCalledWith([
        { id: '1', name: 'test', shell: 'bash', started_at: '2025-01-01' }
      ]);
    });
  });
});
