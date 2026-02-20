import { describe, it, expect, beforeEach } from 'vitest';
import { activityStore, type ActivityType } from './activityStore.svelte';

describe('activityStore', () => {
  beforeEach(() => {
    // Clear all activities by clearing each one
    for (const key of activityStore.activities.keys()) {
      activityStore.clearActivity(key);
    }
  });

  it('starts with empty activities map', () => {
    expect(activityStore.activities).toBeInstanceOf(Map);
    expect(activityStore.activities.size).toBe(0);
  });

  it('setActivity sets activity type for a session', () => {
    activityStore.setActivity('session-1', 'activity');
    expect(activityStore.activities.get('session-1')).toBe('activity');
  });

  it('setActivity sets bell type for a session', () => {
    activityStore.setActivity('session-1', 'bell');
    expect(activityStore.activities.get('session-1')).toBe('bell');
  });

  it('setActivity sets silence type for a session', () => {
    activityStore.setActivity('session-1', 'silence');
    expect(activityStore.activities.get('session-1')).toBe('silence');
  });

  it('clearActivity removes activity for a session', () => {
    activityStore.setActivity('session-1', 'activity');
    expect(activityStore.activities.has('session-1')).toBe(true);

    activityStore.clearActivity('session-1');
    expect(activityStore.activities.has('session-1')).toBe(false);
  });

  it('multiple sessions can have independent activities', () => {
    activityStore.setActivity('session-1', 'activity');
    activityStore.setActivity('session-2', 'bell');
    activityStore.setActivity('session-3', 'silence');

    expect(activityStore.activities.get('session-1')).toBe('activity');
    expect(activityStore.activities.get('session-2')).toBe('bell');
    expect(activityStore.activities.get('session-3')).toBe('silence');
    expect(activityStore.activities.size).toBe(3);
  });

  it('setting activity on already-active session updates the type', () => {
    activityStore.setActivity('session-1', 'activity');
    expect(activityStore.activities.get('session-1')).toBe('activity');

    activityStore.setActivity('session-1', 'bell');
    expect(activityStore.activities.get('session-1')).toBe('bell');
    expect(activityStore.activities.size).toBe(1);
  });

  it('clearActivity on non-existent session is a no-op', () => {
    activityStore.clearActivity('non-existent');
    expect(activityStore.activities.size).toBe(0);
  });

  it('getActivity returns the current activity for a session', () => {
    activityStore.setActivity('session-1', 'bell');
    expect(activityStore.getActivity('session-1')).toBe('bell');
  });

  it('getActivity returns undefined for a session with no activity', () => {
    expect(activityStore.getActivity('non-existent')).toBeUndefined();
  });
});
