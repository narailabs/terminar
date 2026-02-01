import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { createActivityStore, type ActivityType } from './activityStore';

describe('activityStore', () => {
  let store: ReturnType<typeof createActivityStore>;

  beforeEach(() => {
    store = createActivityStore();
  });

  it('starts with empty activities map', () => {
    const state = get(store);
    expect(state.activities).toBeInstanceOf(Map);
    expect(state.activities.size).toBe(0);
  });

  it('setActivity sets activity type for a session', () => {
    store.setActivity('session-1', 'activity');
    const state = get(store);
    expect(state.activities.get('session-1')).toBe('activity');
  });

  it('setActivity sets bell type for a session', () => {
    store.setActivity('session-1', 'bell');
    const state = get(store);
    expect(state.activities.get('session-1')).toBe('bell');
  });

  it('setActivity sets silence type for a session', () => {
    store.setActivity('session-1', 'silence');
    const state = get(store);
    expect(state.activities.get('session-1')).toBe('silence');
  });

  it('clearActivity removes activity for a session', () => {
    store.setActivity('session-1', 'activity');
    expect(get(store).activities.has('session-1')).toBe(true);

    store.clearActivity('session-1');
    expect(get(store).activities.has('session-1')).toBe(false);
  });

  it('multiple sessions can have independent activities', () => {
    store.setActivity('session-1', 'activity');
    store.setActivity('session-2', 'bell');
    store.setActivity('session-3', 'silence');

    const state = get(store);
    expect(state.activities.get('session-1')).toBe('activity');
    expect(state.activities.get('session-2')).toBe('bell');
    expect(state.activities.get('session-3')).toBe('silence');
    expect(state.activities.size).toBe(3);
  });

  it('setting activity on already-active session updates the type', () => {
    store.setActivity('session-1', 'activity');
    expect(get(store).activities.get('session-1')).toBe('activity');

    store.setActivity('session-1', 'bell');
    expect(get(store).activities.get('session-1')).toBe('bell');
    expect(get(store).activities.size).toBe(1);
  });

  it('clearActivity on non-existent session is a no-op', () => {
    // Should not throw
    store.clearActivity('non-existent');
    expect(get(store).activities.size).toBe(0);
  });

  it('getActivity returns the current activity for a session', () => {
    store.setActivity('session-1', 'bell');
    expect(store.getActivity('session-1')).toBe('bell');
  });

  it('getActivity returns undefined for a session with no activity', () => {
    expect(store.getActivity('non-existent')).toBeUndefined();
  });
});
