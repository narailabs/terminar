import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Create mock instances that can be referenced in tests
const mockApp = { destroy: vi.fn() };
let mockMount = vi.fn(() => mockApp);

const mockManagerInstance = {
  on: vi.fn(),
  connect: vi.fn(() => Promise.resolve()),
};
let mockWebSocketSessionManager = vi.fn(() => mockManagerInstance);

const MockAppComponent = { name: 'MockedApp' };

// Mock svelte
vi.mock('svelte', () => ({
  mount: (...args: unknown[]) => mockMount(...args),
}));

// Mock WebSocketSessionManager - use absolute path for resolution
vi.mock('/Users/narayan/src/narai/apps/terminar/web/src/lib/WebSocketSessionManager', () => {
  // Return a class-like constructor that will return the mock instance
  return {
    WebSocketSessionManager: class MockWebSocketSessionManager {
      on = mockManagerInstance.on;
      connect = mockManagerInstance.connect;
      constructor(...args: unknown[]) {
        mockWebSocketSessionManager(...args);
      }
    },
  };
});

// Mock App.svelte - use absolute path for resolution
vi.mock('/Users/narayan/src/narai/apps/terminar/web/src/App.svelte', () => ({
  default: MockAppComponent,
}));

describe('Renderer Entry Point', () => {
  let mockTargetElement: { id: string };
  let savedDocument: unknown;
  let savedWindow: unknown;

  beforeEach(() => {
    vi.resetModules();

    // Reset mock implementations
    mockMount = vi.fn(() => mockApp);
    mockWebSocketSessionManager = vi.fn(() => mockManagerInstance);
    mockManagerInstance.on = vi.fn();
    mockManagerInstance.connect = vi.fn(() => Promise.resolve());

    // Save originals
    savedDocument = (globalThis as Record<string, unknown>).document;
    savedWindow = (globalThis as Record<string, unknown>).window;

    // Create mock target element
    mockTargetElement = { id: 'app' };

    // Mock document.getElementById
    const mockDocument = {
      getElementById: vi.fn((id: string) => {
        if (id === 'app') return mockTargetElement;
        return null;
      }),
    };

    // Set up document mock
    (globalThis as Record<string, unknown>).document = mockDocument;
  });

  afterEach(() => {
    // Restore originals
    (globalThis as Record<string, unknown>).document = savedDocument;
    (globalThis as Record<string, unknown>).window = savedWindow;
    vi.resetAllMocks();
  });

  describe('Svelte app mounting', () => {
    it('should mount Svelte app to #app element', async () => {
      // Set up window without electronAPI
      (globalThis as Record<string, unknown>).window = {};

      await import('../../src/renderer/main.js');

      expect(mockMount).toHaveBeenCalledWith(
        MockAppComponent,
        expect.objectContaining({
          target: mockTargetElement,
        })
      );
    });
  });

  describe('sessionList event handling', () => {
    it('should hook into WebSocketSessionManager sessionList event', async () => {
      // Set up window without electronAPI
      (globalThis as Record<string, unknown>).window = {};

      await import('../../src/renderer/main.js');

      // Verify the manager's on method was called for sessionList
      expect(mockManagerInstance.on).toHaveBeenCalledWith(
        'sessionList',
        expect.any(Function)
      );
    });

    it('should call notifySessionsChanged when sessionList event fires', async () => {
      const mockNotifySessionsChanged = vi.fn();

      // Set up window with electronAPI
      (globalThis as Record<string, unknown>).window = {
        electronAPI: {
          notifySessionsChanged: mockNotifySessionsChanged,
        },
      };

      await import('../../src/renderer/main.js');

      // Get the sessionList handler that was registered
      const sessionListCall = mockManagerInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'sessionList'
      );
      expect(sessionListCall).toBeDefined();

      const handler = sessionListCall![1] as (sessions: unknown[]) => void;

      // Simulate sessionList event firing
      const mockSessions = [
        { id: 'session-1', name: 'Shell 1', status: 'active' },
        { id: 'session-2', name: 'Shell 2', status: 'inactive' },
      ];
      handler(mockSessions);

      expect(mockNotifySessionsChanged).toHaveBeenCalledWith(mockSessions);
    });
  });

  describe('graceful fallback without electronAPI', () => {
    it('should not throw when electronAPI is undefined', async () => {
      // Set up window without electronAPI
      (globalThis as Record<string, unknown>).window = {
        electronAPI: undefined,
      };

      // This should not throw
      await expect(import('../../src/renderer/main.js')).resolves.toBeDefined();
    });

    it('should not call notifySessionsChanged when electronAPI is undefined', async () => {
      // Set up window without electronAPI
      (globalThis as Record<string, unknown>).window = {
        electronAPI: undefined,
      };

      await import('../../src/renderer/main.js');

      // Get the sessionList handler
      const sessionListCall = mockManagerInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'sessionList'
      );

      if (sessionListCall) {
        const handler = sessionListCall[1] as (sessions: unknown[]) => void;

        // Simulate sessionList event firing - should not throw
        const mockSessions = [{ id: 'session-1', name: 'Shell 1', status: 'active' }];
        expect(() => handler(mockSessions)).not.toThrow();
      }
    });

    it('should not call notifySessionsChanged when electronAPI.notifySessionsChanged is undefined', async () => {
      // Set up window with partial electronAPI (no notifySessionsChanged)
      (globalThis as Record<string, unknown>).window = {
        electronAPI: {
          minimize: vi.fn(),
          // notifySessionsChanged is intentionally missing
        },
      };

      await import('../../src/renderer/main.js');

      // Get the sessionList handler
      const sessionListCall = mockManagerInstance.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'sessionList'
      );

      if (sessionListCall) {
        const handler = sessionListCall[1] as (sessions: unknown[]) => void;

        // Simulate sessionList event firing - should not throw
        const mockSessions = [{ id: 'session-1', name: 'Shell 1', status: 'active' }];
        expect(() => handler(mockSessions)).not.toThrow();
      }
    });
  });
});
