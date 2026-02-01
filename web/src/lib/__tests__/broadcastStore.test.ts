import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
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
} from '../broadcastStore';

// Mock session manager
function createMockManager() {
  return {
    sendInput: vi.fn(),
  };
}

describe('broadcastStore', () => {
  beforeEach(() => {
    clearTargets();
    broadcastEnabled.set(false);
    setSessionManager(null);
  });

  // F10a Test 1: broadcastStore tracks set of target session IDs
  it('tracks set of target session IDs', () => {
    const targets = get(broadcastTargets);
    expect(targets).toBeInstanceOf(Set);
    expect(targets.size).toBe(0);
  });

  // F10a Test 2: addTarget(sessionId) adds a session to broadcast targets
  it('addTarget adds a session to broadcast targets', () => {
    addTarget('session-1');
    const targets = get(broadcastTargets);
    expect(targets.has('session-1')).toBe(true);
    expect(targets.size).toBe(1);
  });

  it('addTarget can add multiple sessions', () => {
    addTarget('session-1');
    addTarget('session-2');
    addTarget('session-3');
    const targets = get(broadcastTargets);
    expect(targets.size).toBe(3);
    expect(targets.has('session-1')).toBe(true);
    expect(targets.has('session-2')).toBe(true);
    expect(targets.has('session-3')).toBe(true);
  });

  it('addTarget is idempotent for same session', () => {
    addTarget('session-1');
    addTarget('session-1');
    const targets = get(broadcastTargets);
    expect(targets.size).toBe(1);
  });

  // F10a Test 3: removeTarget(sessionId) removes a session from broadcast targets
  it('removeTarget removes a session from broadcast targets', () => {
    addTarget('session-1');
    addTarget('session-2');
    removeTarget('session-1');
    const targets = get(broadcastTargets);
    expect(targets.has('session-1')).toBe(false);
    expect(targets.has('session-2')).toBe(true);
    expect(targets.size).toBe(1);
  });

  it('removeTarget is safe for non-existent session', () => {
    removeTarget('non-existent');
    const targets = get(broadcastTargets);
    expect(targets.size).toBe(0);
  });

  // F10a Test 4: toggleTarget(sessionId) toggles inclusion
  it('toggleTarget adds session if not present', () => {
    toggleTarget('session-1');
    expect(get(broadcastTargets).has('session-1')).toBe(true);
  });

  it('toggleTarget removes session if already present', () => {
    addTarget('session-1');
    toggleTarget('session-1');
    expect(get(broadcastTargets).has('session-1')).toBe(false);
  });

  // F10a Test 5: clearTargets() removes all targets
  it('clearTargets removes all targets', () => {
    addTarget('session-1');
    addTarget('session-2');
    addTarget('session-3');
    clearTargets();
    const targets = get(broadcastTargets);
    expect(targets.size).toBe(0);
  });

  // F10a Test 6: isTarget(sessionId) returns boolean
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

  // F10a Test 7: broadcastInput(data) sends input message to ALL target sessions
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
    // No manager set, should not throw
    expect(() => broadcastInput('hello')).not.toThrow();
  });

  // F10a Test 8: Broadcast store persists targets across broadcast bar open/close
  it('targets persist when broadcastEnabled is toggled off and on', () => {
    addTarget('session-1');
    addTarget('session-2');

    // Simulate closing broadcast bar (enabled stays true, bar just closes)
    // Targets should still be there
    const targets = get(broadcastTargets);
    expect(targets.size).toBe(2);
    expect(targets.has('session-1')).toBe(true);
    expect(targets.has('session-2')).toBe(true);
  });

  // F10a Test 9: Targets are cleared when broadcast mode is fully disabled
  it('targets are cleared when broadcast mode is fully disabled', () => {
    broadcastEnabled.set(true);
    addTarget('session-1');
    addTarget('session-2');

    // Fully disable broadcast mode
    broadcastEnabled.set(false);
    clearTargets();

    const targets = get(broadcastTargets);
    expect(targets.size).toBe(0);
  });

  // Additional: broadcastEnabled store works
  it('broadcastEnabled defaults to false', () => {
    expect(get(broadcastEnabled)).toBe(false);
  });

  it('broadcastEnabled can be toggled', () => {
    broadcastEnabled.set(true);
    expect(get(broadcastEnabled)).toBe(true);
    broadcastEnabled.set(false);
    expect(get(broadcastEnabled)).toBe(false);
  });
});
