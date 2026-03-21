import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiWindowCoordinator } from '../../src/main/MultiWindowCoordinator.js';

/** Create a minimal mock BrowserWindow with controllable id and event handling. */
function mockWindow(id: number) {
  const handlers: Record<string, Function> = {};
  return {
    id,
    on: vi.fn((event: string, handler: Function) => {
      handlers[event] = handler;
    }),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
    /** Trigger a registered event handler (test helper). */
    _trigger: (event: string) => handlers[event]?.(),
  };
}

describe('MultiWindowCoordinator', () => {
  let coordinator: MultiWindowCoordinator;

  beforeEach(() => {
    coordinator = new MultiWindowCoordinator();
  });

  it('should register and track windows', () => {
    const win = mockWindow(1);
    coordinator.register(win as any, 'tab-main');
    expect(coordinator.getTabForWindow(1)).toBe('tab-main');
    expect(coordinator.windowCount).toBe(1);
  });

  it('should track multiple windows', () => {
    coordinator.register(mockWindow(1) as any, 'tab-main');
    coordinator.register(mockWindow(2) as any, 'tab-dev');
    expect(coordinator.windowCount).toBe(2);
    expect(coordinator.getTabForWindow(1)).toBe('tab-main');
    expect(coordinator.getTabForWindow(2)).toBe('tab-dev');
  });

  it('should return undefined for unregistered window', () => {
    expect(coordinator.getTabForWindow(999)).toBeUndefined();
  });

  it('should find next available tab', () => {
    coordinator.register(mockWindow(1) as any, 'tab-main');
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBe('tab-dev');
  });

  it('should return null when all tabs are shown', () => {
    coordinator.register(mockWindow(1) as any, 'tab-main');
    coordinator.register(mockWindow(2) as any, 'tab-dev');
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBeNull();
  });

  it('should return first tab when no windows exist', () => {
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBe('tab-main');
  });

  it('should return null for empty tab list', () => {
    expect(coordinator.getNextAvailableTab([])).toBeNull();
  });

  it('should clean up on window close', () => {
    const win = mockWindow(1);
    coordinator.register(win as any, 'tab-main');
    expect(coordinator.windowCount).toBe(1);

    win._trigger('closed');

    expect(coordinator.windowCount).toBe(0);
    expect(coordinator.getTabForWindow(1)).toBeUndefined();
  });

  it('should free tab after window close so it becomes available', () => {
    const win = mockWindow(1);
    coordinator.register(win as any, 'tab-main');
    coordinator.register(mockWindow(2) as any, 'tab-dev');

    // All tabs are shown
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBeNull();

    // Close window 1 — tab-main should become available
    win._trigger('closed');
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBe('tab-main');
  });

  it('should broadcast to other windows only', () => {
    const win1 = mockWindow(1);
    const win2 = mockWindow(2);
    const win3 = mockWindow(3);
    coordinator.register(win1 as any, 'tab-main');
    coordinator.register(win2 as any, 'tab-dev');
    coordinator.register(win3 as any, 'tab-staging');

    coordinator.broadcastToOthers(1, 'update', { data: 'test' });

    expect(win1.webContents.send).not.toHaveBeenCalled();
    expect(win2.webContents.send).toHaveBeenCalledWith('update', { data: 'test' });
    expect(win3.webContents.send).toHaveBeenCalledWith('update', { data: 'test' });
  });

  it('should skip destroyed windows during broadcast', () => {
    const win1 = mockWindow(1);
    const win2 = mockWindow(2);
    win2.isDestroyed.mockReturnValue(true);

    coordinator.register(win1 as any, 'tab-main');
    coordinator.register(win2 as any, 'tab-dev');

    coordinator.broadcastToOthers(1, 'update', { data: 'test' });

    expect(win2.webContents.send).not.toHaveBeenCalled();
  });

  it('should handle broadcast with no other windows', () => {
    const win1 = mockWindow(1);
    coordinator.register(win1 as any, 'tab-main');

    // Should not throw
    coordinator.broadcastToOthers(1, 'update', { data: 'test' });
    expect(win1.webContents.send).not.toHaveBeenCalled();
  });
});
