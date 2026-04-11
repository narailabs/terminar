import { describe, it, expect, beforeEach } from 'vitest';
import { sessionCwdStore } from '../sessionCwdStore.svelte';

describe('sessionCwdStore', () => {
  beforeEach(() => {
    sessionCwdStore.clear();
  });

  it('should store and retrieve CWD for a session', () => {
    sessionCwdStore.set('session-1', '/home/user/project');
    expect(sessionCwdStore.get('session-1')).toBe('/home/user/project');
  });

  it('should return undefined for unknown sessions', () => {
    expect(sessionCwdStore.get('unknown')).toBeUndefined();
  });

  it('should update CWD when set again', () => {
    sessionCwdStore.set('session-1', '/home/user');
    sessionCwdStore.set('session-1', '/home/user/project');
    expect(sessionCwdStore.get('session-1')).toBe('/home/user/project');
  });

  it('deleteStaleSessions removes entries not in the current set', () => {
    sessionCwdStore.set('session-1', '/a');
    sessionCwdStore.set('session-2', '/b');
    sessionCwdStore.set('session-3', '/c');
    sessionCwdStore.deleteStaleSessions(new Set(['session-1', 'session-3']));
    expect(sessionCwdStore.get('session-1')).toBe('/a');
    expect(sessionCwdStore.get('session-2')).toBeUndefined();
    expect(sessionCwdStore.get('session-3')).toBe('/c');
  });
});
