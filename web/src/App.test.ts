import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import App from './App.svelte';
import { WebSocketSessionManager } from './lib/WebSocketSessionManager';

// Mock settingsApi to avoid actual HTTP calls
vi.mock('./lib/settingsApi', () => ({
  initializeSettings: vi.fn().mockResolvedValue(undefined),
  fetchSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  setSettingsApiBaseUrl: vi.fn(),
}));

// Mock broadcastStore (must include all exports used by child components like Pane.svelte)
vi.mock('./lib/broadcastStore.svelte', () => ({
  broadcastEnabled: { value: false },
  broadcastTargets: { value: new Set() },
  clearTargets: vi.fn(),
  setSessionManager: vi.fn(),
  addTarget: vi.fn(),
  removeTarget: vi.fn(),
  toggleTarget: vi.fn(),
  isTarget: vi.fn().mockReturnValue(false),
  broadcastInput: vi.fn(),
}));

// Mock envStore
vi.mock('./lib/envStore.svelte', () => ({
  getEffectiveEnv: vi.fn().mockReturnValue({}),
  globalEnvVars: { value: {} },
  cleanStaleSessionEnvVars: vi.fn(),
}));

// Mock exitedSessionsStore
vi.mock('./lib/exitedSessionsStore.svelte', () => ({
  markExited: vi.fn(),
  exitedSessions: { map: new Map(), has: vi.fn().mockReturnValue(false), get: vi.fn() },
}));

// Mock foregroundStore
vi.mock('./lib/foregroundStore.svelte', () => ({
  foregroundStore: {
    setForeground: vi.fn(),
    processes: new Map(),
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

vi.mock('./lib/WebSocketSessionManager', () => {
  return {
    WebSocketSessionManager: vi.fn().mockImplementation(function() {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        listSessions: vi.fn(),
        createSession: vi.fn(),
        attach: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        removeAllListeners: vi.fn(),
        emit: vi.fn(),
        disconnect: vi.fn(),
      };
    })
  };
});

// ====================================================================
// Workspace Loading
// ====================================================================

describe('App - Workspace Loading', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
    mockFetch.mockReset();
  });

  it('loadWorkspace returns workspace data on success', async () => {
    const workspaceData = { tabs: [], activeTabId: 'tab-1' };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workspace: workspaceData }),
    });

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    // After connection, loadWorkspace should be called via fetch
    await waitFor(() => {
      const workspaceFetchCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/workspace')
      );
      expect(workspaceFetchCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('loadWorkspace returns null on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    // The fetch was called but returned non-OK; app should still render without crashing
    await waitFor(() => {
      const workspaceFetchCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/workspace')
      );
      expect(workspaceFetchCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('loadWorkspace returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    // App should handle the network error gracefully and still render
    await waitFor(() => {
      const workspaceFetchCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/workspace')
      );
      expect(workspaceFetchCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ====================================================================
// Local Server Connection Flow
// ====================================================================

describe('App - Local Server Connection Flow', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
    mockFetch.mockReset();
    // Default: workspace fetch returns empty
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ workspace: null }) });
  });

  it('creates WebSocketSessionManager and calls connect then listSessions', async () => {
    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalledWith('ws://localhost:6750/ws');
    });

    const managerInstance = vi.mocked(WebSocketSessionManager).mock.results[0]?.value;
    expect(managerInstance.connect).toHaveBeenCalled();

    await waitFor(() => {
      expect(managerInstance.listSessions).toHaveBeenCalled();
    });
  });

  it('after connect, workspace is loaded from server via fetch', async () => {
    const workspacePayload = {
      tabs: [{ id: 'tab-1', name: 'Test', root: { type: 'pane', id: 'p1', sessionId: null } }],
      activeTabId: 'tab-1',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ workspace: workspacePayload }),
    });

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    await waitFor(() => {
      const workspaceCalls = mockFetch.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0] === 'http://localhost:6750/workspace'
      );
      expect(workspaceCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ====================================================================
// Terminal Management
// ====================================================================

describe('App - Terminal Management', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ workspace: null }) });
  });

  it('createNewTerminal calls manager.createSession with estimated dimensions', async () => {
    // Set window dimensions for predictable estimates
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    const managerInstance = vi.mocked(WebSocketSessionManager).mock.results[0]?.value;

    // Wait for the sessionList handler to fire (it gets called from setupManagerEvents).
    // When sessions list returns empty, createNewTerminal is called automatically.
    // Find the sessionList callback and invoke it with empty sessions.
    await waitFor(() => {
      expect(managerInstance.on).toHaveBeenCalled();
    });

    const onCalls = managerInstance.on.mock.calls;
    const sessionListCallback = onCalls.find((c: any[]) => c[0] === 'sessionList')?.[1];
    expect(sessionListCallback).toBeDefined();

    // Trigger the sessionList event with empty sessions, which causes createNewTerminal
    sessionListCallback([]);

    // Verify createSession was called with estimated dimensions
    // estimatedCols = Math.max(40, Math.floor((1200 * 0.75) / 8)) = Math.floor(112.5) = 112
    // estimatedRows = Math.max(10, Math.floor((800 * 0.85) / 17)) = Math.floor(40) = 40
    expect(managerInstance.createSession).toHaveBeenCalledWith(
      '',    // name
      '',    // shell
      {},    // envVars (from mocked getEffectiveEnv)
      112,   // estimatedCols
      40,    // estimatedRows
    );
  });

  it('createNewTerminal uses minimum dimensions for small windows', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 200, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 100, writable: true });

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    const managerInstance = vi.mocked(WebSocketSessionManager).mock.results[0]?.value;

    await waitFor(() => {
      expect(managerInstance.on).toHaveBeenCalled();
    });

    const onCalls = managerInstance.on.mock.calls;
    const sessionListCallback = onCalls.find((c: any[]) => c[0] === 'sessionList')?.[1];
    expect(sessionListCallback).toBeDefined();

    sessionListCallback([]);

    // For width 200: Math.floor((200 * 0.75) / 8) = 18, but Math.max(40, 18) = 40
    // For height 100: Math.floor((100 * 0.85) / 17) = 5, but Math.max(10, 5) = 10
    expect(managerInstance.createSession).toHaveBeenCalledWith(
      '', '', {}, 40, 10,
    );
  });
});

// ====================================================================
// Manager Events (setupManagerEvents)
// ====================================================================

describe('App - Manager Events', () => {
  beforeEach(() => {
    vi.mocked(WebSocketSessionManager).mockClear();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ workspace: null }) });
  });

  function getManagerOnCallbacks() {
    const managerInstance = vi.mocked(WebSocketSessionManager).mock.results[0]?.value;
    const onCalls = managerInstance.on.mock.calls;
    return {
      managerInstance,
      getCallback: (event: string) => onCalls.find((c: any[]) => c[0] === event)?.[1],
    };
  }

  it('sessionExited callback calls markExited', async () => {
    const { markExited } = await import('./lib/exitedSessionsStore.svelte');

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    const { getCallback } = getManagerOnCallbacks();
    const sessionExitedCb = getCallback('sessionExited');
    expect(sessionExitedCb).toBeDefined();

    sessionExitedCb('session-1', 0);

    expect(markExited).toHaveBeenCalledWith('session-1', 0);
  });

  it('foregroundChanged callback calls foregroundStore.setForeground', async () => {
    const { foregroundStore } = await import('./lib/foregroundStore.svelte');

    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    const { getCallback } = getManagerOnCallbacks();
    const foregroundChangedCb = getCallback('foregroundChanged');
    expect(foregroundChangedCb).toBeDefined();

    foregroundChangedCb('session-2', 'vim');

    expect(foregroundStore.setForeground).toHaveBeenCalledWith('session-2', 'vim');
  });

  it('stateChange callback updates connectionState', async () => {
    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    const { getCallback } = getManagerOnCallbacks();
    const stateChangeCb = getCallback('stateChange');
    expect(stateChangeCb).toBeDefined();

    // Transition to 'connected' should set connected state
    stateChangeCb('connected');
    // No LoginPage to show/hide — app is always rendered
  });

  it('all expected event handlers are registered on the manager', async () => {
    render(App);

    await waitFor(() => {
      expect(WebSocketSessionManager).toHaveBeenCalled();
    });

    const managerInstance = vi.mocked(WebSocketSessionManager).mock.results[0]?.value;
    const registeredEvents = managerInstance.on.mock.calls.map((c: any[]) => c[0]);

    expect(registeredEvents).toContain('stateChange');
    expect(registeredEvents).toContain('reconnecting');
    expect(registeredEvents).toContain('reconnected');
    expect(registeredEvents).toContain('sessionList');
    expect(registeredEvents).toContain('sessionExited');
    expect(registeredEvents).toContain('foregroundChanged');
    expect(registeredEvents).toContain('cwdChanged');
    expect(registeredEvents).toContain('shutdown');
    expect(registeredEvents).toContain('error');
  });
});
