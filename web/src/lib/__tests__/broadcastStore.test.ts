import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  broadcastTargets,
  broadcastEnabled,
  addTarget,
  removeTarget,
  toggleTarget,
  clearTargets,
  isTarget,
  broadcastInput,
  setSessionManager,
} from '../broadcastStore.svelte';

// Mock session manager
function createMockManager() {
  return {
    sendInput: vi.fn(),
  };
}

describe('broadcastStore', () => {
  beforeEach(() => {
    clearTargets();
    broadcastEnabled.value = false;
    setSessionManager(null);
  });

  it('tracks set of target session IDs', () => {
    const targets = broadcastTargets.value;
    expect(targets).toBeInstanceOf(Set);
    expect(targets.size).toBe(0);
  });

  it('addTarget adds a session to broadcast targets', () => {
    addTarget('session-1');
    expect(broadcastTargets.value.has('session-1')).toBe(true);
    expect(broadcastTargets.value.size).toBe(1);
  });

  it('addTarget can add multiple sessions', () => {
    addTarget('session-1');
    addTarget('session-2');
    addTarget('session-3');
    expect(broadcastTargets.value.size).toBe(3);
    expect(broadcastTargets.value.has('session-1')).toBe(true);
    expect(broadcastTargets.value.has('session-2')).toBe(true);
    expect(broadcastTargets.value.has('session-3')).toBe(true);
  });

  it('addTarget is idempotent for same session', () => {
    addTarget('session-1');
    addTarget('session-1');
    expect(broadcastTargets.value.size).toBe(1);
  });

  it('removeTarget removes a session from broadcast targets', () => {
    addTarget('session-1');
    addTarget('session-2');
    removeTarget('session-1');
    expect(broadcastTargets.value.has('session-1')).toBe(false);
    expect(broadcastTargets.value.has('session-2')).toBe(true);
    expect(broadcastTargets.value.size).toBe(1);
  });

  it('removeTarget is safe for non-existent session', () => {
    removeTarget('non-existent');
    expect(broadcastTargets.value.size).toBe(0);
  });

  it('toggleTarget adds session if not present', () => {
    toggleTarget('session-1');
    expect(broadcastTargets.value.has('session-1')).toBe(true);
  });

  it('toggleTarget removes session if already present', () => {
    addTarget('session-1');
    toggleTarget('session-1');
    expect(broadcastTargets.value.has('session-1')).toBe(false);
  });

  it('clearTargets removes all targets', () => {
    addTarget('session-1');
    addTarget('session-2');
    addTarget('session-3');
    clearTargets();
    expect(broadcastTargets.value.size).toBe(0);
  });

  it('isTarget returns true for added sessions', () => {
    addTarget('session-1');
    expect(isTarget('session-1')).toBe(true);
  });

  it('isTarget returns false for sessions not added', () => {
    expect(isTarget('session-1')).toBe(false);
  });

  it('isTarget returns false after removal', () => {
    addTarget('session-1');
    removeTarget('session-1');
    expect(isTarget('session-1')).toBe(false);
  });

  it('broadcastInput sends input to all target sessions', () => {
    const mockManager = createMockManager();
    setSessionManager(mockManager as any);

    addTarget('session-1');
    addTarget('session-2');
    addTarget('session-3');

    broadcastInput('hello');

    expect(mockManager.sendInput).toHaveBeenCalledTimes(3);
    expect(mockManager.sendInput).toHaveBeenCalledWith('session-1', 'hello');
    expect(mockManager.sendInput).toHaveBeenCalledWith('session-2', 'hello');
    expect(mockManager.sendInput).toHaveBeenCalledWith('session-3', 'hello');
  });

  it('broadcastInput does nothing with no targets', () => {
    const mockManager = createMockManager();
    setSessionManager(mockManager as any);

    broadcastInput('hello');

    expect(mockManager.sendInput).not.toHaveBeenCalled();
  });

  it('broadcastInput does nothing without a session manager', () => {
    addTarget('session-1');
    expect(() => broadcastInput('hello')).not.toThrow();
  });

  it('targets persist when broadcastEnabled is toggled off and on', () => {
    addTarget('session-1');
    addTarget('session-2');

    expect(broadcastTargets.value.size).toBe(2);
    expect(broadcastTargets.value.has('session-1')).toBe(true);
    expect(broadcastTargets.value.has('session-2')).toBe(true);
  });

  it('targets are cleared when broadcast mode is fully disabled', () => {
    broadcastEnabled.value = true;
    addTarget('session-1');
    addTarget('session-2');

    broadcastEnabled.value = false;
    clearTargets();

    expect(broadcastTargets.value.size).toBe(0);
  });

  it('broadcastEnabled defaults to false', () => {
    expect(broadcastEnabled.value).toBe(false);
  });

  it('broadcastEnabled can be toggled', () => {
    broadcastEnabled.value = true;
    expect(broadcastEnabled.value).toBe(true);
    broadcastEnabled.value = false;
    expect(broadcastEnabled.value).toBe(false);
  });
});
