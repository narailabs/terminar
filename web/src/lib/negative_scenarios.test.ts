import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketSessionManager } from './WebSocketSessionManager';
import { WebSocket, Server } from 'mock-socket';

// Polyfill global WebSocket
global.WebSocket = WebSocket;

/**
 * Negative scenario tests for the web client's WebSocketSessionManager.
 *
 * Tests connection failure handling, invalid message handling,
 * and timeout handling scenarios.
 */
describe('WebSocketSessionManager Negative Scenarios', () => {
  const url = 'ws://localhost:9876';

  // ==================== Connection Failure Handling ====================

  describe('Connection Failures', () => {
    it('should handle connection to unreachable server', async () => {
      // No mock server running at this URL
      const manager = new WebSocketSessionManager('ws://localhost:19999');

      manager.on('error', () => {}); // Suppress unhandled errors

      const connectPromise = manager.connect();
      await expect(
        Promise.race([
          connectPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500))
        ])
      ).rejects.toThrow();

      manager.disconnect();
    });

    it('should start in disconnected state before connect', () => {
      const manager = new WebSocketSessionManager(url);
      expect(manager.getState()).toBe('disconnected');
    });

    it('should emit stateChange to connecting then fail', async () => {
      const manager = new WebSocketSessionManager('ws://localhost:19999');
      const states: string[] = [];
      manager.on('stateChange', (state: string) => states.push(state));
      manager.on('error', () => {}); // Suppress

      try {
        await Promise.race([
          manager.connect(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500))
        ]);
      } catch {
        // Expected
      }

      expect(states).toContain('connecting');
      manager.disconnect();
    });
  });

  // ==================== Invalid Message Handling ====================

  describe('Invalid Message Handling', () => {
    let mockServer: Server;

    beforeEach(() => {
      mockServer = new Server(url);
    });

    afterEach(() => {
      mockServer.stop();
    });

    it('should handle server sending invalid JSON', async () => {
      mockServer.on('connection', (socket) => {
        // Send invalid JSON from server
        socket.send('this is not valid JSON');
      });

      const manager = new WebSocketSessionManager(url);
      const errorSpy = vi.fn();
      manager.on('error', errorSpy);

      await manager.connect();

      // Wait for the message to be processed
      await new Promise(r => setTimeout(r, 100));

      // Manager should still be functional (not crashed)
      expect(manager).toBeDefined();
      manager.disconnect();
    });

    it('should handle server sending empty string', async () => {
      mockServer.on('connection', (socket) => {
        socket.send('');
      });

      const manager = new WebSocketSessionManager(url);
      manager.on('error', () => {}); // Suppress

      await manager.connect();
      await new Promise(r => setTimeout(r, 100));

      expect(manager).toBeDefined();
      manager.disconnect();
    });

    it('should handle server sending null-like values', async () => {
      mockServer.on('connection', (socket) => {
        socket.send('null');
        socket.send('undefined');
        socket.send('0');
      });

      const manager = new WebSocketSessionManager(url);
      manager.on('error', () => {}); // Suppress

      await manager.connect();
      await new Promise(r => setTimeout(r, 100));

      expect(manager).toBeDefined();
      manager.disconnect();
    });

    it('should not emit sessionList for SessionList without sessions', () => {
      const manager = new WebSocketSessionManager(url);
      const sessionListSpy = vi.fn();
      manager.on('sessionList', sessionListSpy);

      // Simulate receiving a malformed SessionList
      (manager as any).handleMessage({ type: 'SessionList' });

      expect(sessionListSpy).not.toHaveBeenCalled();
    });

    it('should not emit output for Output without data', () => {
      const manager = new WebSocketSessionManager(url);
      const outputSpy = vi.fn();
      manager.on('output', outputSpy);

      (manager as any).handleMessage({ type: 'Output', session_id: 'test' });

      expect(outputSpy).not.toHaveBeenCalled();
    });

    it('should not emit output for Output without session_id', () => {
      const manager = new WebSocketSessionManager(url);
      const outputSpy = vi.fn();
      manager.on('output', outputSpy);

      (manager as any).handleMessage({ type: 'Output', data: 'some data' });

      expect(outputSpy).not.toHaveBeenCalled();
    });

    it('should not emit error for Error without message field', () => {
      const manager = new WebSocketSessionManager(url);
      const errorSpy = vi.fn();
      manager.on('error', errorSpy);

      (manager as any).handleMessage({ type: 'Error' });

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('should handle completely unexpected message shape', () => {
      const manager = new WebSocketSessionManager(url);
      const errorSpy = vi.fn();
      manager.on('error', errorSpy);

      // Message with no type field
      (manager as any).handleMessage({});
      (manager as any).handleMessage({ foo: 'bar' });
      (manager as any).handleMessage(42 as any);
      (manager as any).handleMessage(null as any);

      // Should not crash - error events may or may not be emitted
      expect(manager).toBeDefined();
    });

    it('should handle Shutdown message with missing reason', () => {
      const manager = new WebSocketSessionManager(url);
      const shutdownSpy = vi.fn();
      manager.on('shutdown', shutdownSpy);

      (manager as any).handleMessage({ type: 'Shutdown' });

      // May or may not emit shutdown - should not crash
      expect(manager).toBeDefined();
    });

    it('should handle SessionClosed without session_id', () => {
      const manager = new WebSocketSessionManager(url);
      const closedSpy = vi.fn();
      manager.on('sessionClosed', closedSpy);

      (manager as any).handleMessage({ type: 'SessionClosed' });

      // Should not crash, may not emit
      expect(manager).toBeDefined();
    });
  });

  // ==================== Timeout Handling ====================

  describe('Timeout Handling', () => {
    let mockServer: Server;

    beforeEach(() => {
      mockServer = new Server(url);
    });

    afterEach(() => {
      mockServer.stop();
    });

    it('should handle sending messages when not connected', () => {
      const manager = new WebSocketSessionManager(url);

      // These should not crash even when not connected
      expect(() => manager.listSessions()).not.toThrow();
      expect(() => manager.sendInput('session-1', 'test')).not.toThrow();
      expect(() => manager.createSession('/tmp', 'bash')).not.toThrow();
      expect(() => manager.killSession('session-1')).not.toThrow();
    });

    it('should return empty session list when not connected', () => {
      const manager = new WebSocketSessionManager(url);
      expect(manager.getLastSessionList()).toEqual([]);
    });

    it('should handle rapid connect/disconnect', async () => {
      const manager = new WebSocketSessionManager(url);

      // Rapidly connect and disconnect
      const connectPromise = manager.connect();
      manager.disconnect();

      // Should not crash or leave hanging promises
      await Promise.race([
        connectPromise.catch(() => {}),
        new Promise(r => setTimeout(r, 500))
      ]);

      expect(manager.getState()).toBe('disconnected');
    });

    it('should handle disconnect during reconnection', async () => {
      const manager = new WebSocketSessionManager(url, undefined, {
        baseDelay: 50,
        maxDelay: 100,
        maxRetries: 3,
        jitter: 0,
      });

      manager.on('error', () => {}); // Suppress

      await manager.connect();

      // Force a reconnection state by stopping the server
      mockServer.stop();

      // Wait briefly for reconnection to start
      await new Promise(r => setTimeout(r, 100));

      // Disconnect during reconnection
      manager.disconnect();

      expect(manager.getState()).toBe('disconnected');
    });
  });

  // ==================== Multiple Rapid Operations ====================

  describe('Rapid Operations', () => {
    let mockServer: Server;

    beforeEach(() => {
      mockServer = new Server(url);
    });

    afterEach(() => {
      mockServer.stop();
    });

    it('should handle rapid listSessions calls', async () => {
      const manager = new WebSocketSessionManager(url);
      await manager.connect();

      // Send 50 rapid list_sessions
      for (let i = 0; i < 50; i++) {
        manager.listSessions();
      }

      await new Promise(r => setTimeout(r, 100));
      expect(manager).toBeDefined();
      manager.disconnect();
    });

    it('should handle rapid sendInput calls', async () => {
      const manager = new WebSocketSessionManager(url);
      await manager.connect();

      for (let i = 0; i < 100; i++) {
        manager.sendInput('test-session', `message-${i}`);
      }

      await new Promise(r => setTimeout(r, 100));
      expect(manager).toBeDefined();
      manager.disconnect();
    });

    it('should handle multiple concurrent connect calls', async () => {
      const manager = new WebSocketSessionManager(url);

      // Multiple connect calls should not cause issues
      const promises = [
        manager.connect(),
        manager.connect(),
        manager.connect(),
      ];

      await Promise.all(promises.map(p => p.catch(() => {})));
      expect(manager.getState()).toBe('connected');
      manager.disconnect();
    });
  });
});
