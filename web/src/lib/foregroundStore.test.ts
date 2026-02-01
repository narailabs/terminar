import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { createForegroundStore } from './foregroundStore';

describe('foregroundStore', () => {
  let store: ReturnType<typeof createForegroundStore>;

  beforeEach(() => {
    store = createForegroundStore();
  });

  // Test 1: Store starts with empty processes map
  it('starts with empty processes map', () => {
    const state = get(store);
    expect(state.processes).toBeInstanceOf(Map);
    expect(state.processes.size).toBe(0);
  });

  // Test 2: setForeground sets process for a session
  it('setForeground sets process for a session', () => {
    store.setForeground('session-1', 'claude');
    const state = get(store);
    expect(state.processes.get('session-1')).toBe('claude');
  });

  // Test 3: getForeground returns the set process name
  it('getForeground returns the set process name', () => {
    store.setForeground('session-1', 'claude');
    expect(store.getForeground('session-1')).toBe('claude');
  });

  // Test 4: getForeground returns undefined for unknown sessions
  it('getForeground returns undefined for unknown sessions', () => {
    expect(store.getForeground('unknown')).toBeUndefined();
  });

  // Test 5: setForeground with null sets null (no foreground process)
  it('setForeground with null sets null', () => {
    store.setForeground('session-1', null);
    const state = get(store);
    expect(state.processes.has('session-1')).toBe(true);
    expect(state.processes.get('session-1')).toBeNull();
  });

  // Test 6: removeForeground removes the session entry
  it('removeForeground removes the session entry', () => {
    store.setForeground('session-1', 'claude');
    store.removeForeground('session-1');
    const state = get(store);
    expect(state.processes.has('session-1')).toBe(false);
  });

  // Test 7: Multiple sessions can have independent foreground processes
  it('multiple sessions have independent foreground processes', () => {
    store.setForeground('session-1', 'claude');
    store.setForeground('session-2', 'gemini');
    store.setForeground('session-3', 'aider');
    expect(store.getForeground('session-1')).toBe('claude');
    expect(store.getForeground('session-2')).toBe('gemini');
    expect(store.getForeground('session-3')).toBe('aider');
  });

  // Test 8: setForeground updates existing entry
  it('setForeground updates existing entry', () => {
    store.setForeground('session-1', 'claude');
    store.setForeground('session-1', 'gemini');
    expect(store.getForeground('session-1')).toBe('gemini');
    const state = get(store);
    expect(state.processes.size).toBe(1);
  });
});
