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
});
