import { describe, it, expect, beforeEach } from 'vitest';
import {
  exitedSessions,
  markExited,
  isExited,
  getExitInfo,
  removeExited,
  type ExitedSessionInfo,
} from './exitedSessionsStore.svelte';

describe('exitedSessionsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    for (const id of exitedSessions.map.keys()) {
      removeExited(id);
    }
  });

  it('starts with an empty sessions map', () => {
    expect(exitedSessions.map).toBeInstanceOf(Map);
    expect(exitedSessions.map.size).toBe(0);
  });

  it('markExited adds session with exit code 0', () => {
    markExited('session-1', 0);
    expect(exitedSessions.map.size).toBe(1);
    expect(exitedSessions.map.get('session-1')?.exitCode).toBe(0);
  });

  it('markExited adds session with exit code 1', () => {
    markExited('session-1', 1);
    expect(exitedSessions.map.get('session-1')?.exitCode).toBe(1);
  });

  it('markExited adds session with null exit code', () => {
    markExited('session-1', null);
    expect(exitedSessions.map.get('session-1')?.exitCode).toBeNull();
  });

  it('isExited returns true for exited sessions', () => {
    markExited('session-1', 0);
    expect(isExited('session-1')).toBe(true);
  });

  it('isExited returns false for non-exited sessions', () => {
    expect(isExited('session-unknown')).toBe(false);
  });

  it('getExitInfo returns the exit info object', () => {
    markExited('session-1', 42);
    const info = getExitInfo('session-1');
    expect(info).toBeDefined();
    expect(info!.sessionId).toBe('session-1');
    expect(info!.exitCode).toBe(42);
    expect(typeof info!.exitedAt).toBe('number');
  });

  it('getExitInfo returns undefined for non-exited sessions', () => {
    const info = getExitInfo('session-unknown');
    expect(info).toBeUndefined();
  });

  it('removeExited removes the session from the store', () => {
    markExited('session-1', 0);
    expect(isExited('session-1')).toBe(true);
    removeExited('session-1');
    expect(isExited('session-1')).toBe(false);
    expect(exitedSessions.map.size).toBe(0);
  });

  it('removeExited on non-existent session is a no-op', () => {
    markExited('session-1', 0);
    removeExited('does-not-exist');
    expect(exitedSessions.map.size).toBe(1);
  });

  it('multiple sessions can be tracked independently', () => {
    markExited('session-a', 0);
    markExited('session-b', 1);
    markExited('session-c', null);

    expect(exitedSessions.map.size).toBe(3);
    expect(isExited('session-a')).toBe(true);
    expect(isExited('session-b')).toBe(true);
    expect(isExited('session-c')).toBe(true);

    expect(getExitInfo('session-a')?.exitCode).toBe(0);
    expect(getExitInfo('session-b')?.exitCode).toBe(1);
    expect(getExitInfo('session-c')?.exitCode).toBeNull();

    removeExited('session-b');
    expect(exitedSessions.map.size).toBe(2);
    expect(isExited('session-b')).toBe(false);
    expect(isExited('session-a')).toBe(true);
    expect(isExited('session-c')).toBe(true);
  });

  it('markExited includes a timestamp (exitedAt)', () => {
    const before = Date.now();
    markExited('session-1', 0);
    const after = Date.now();

    const info = getExitInfo('session-1');
    expect(info).toBeDefined();
    expect(info!.exitedAt).toBeGreaterThanOrEqual(before);
    expect(info!.exitedAt).toBeLessThanOrEqual(after);
  });

  it('exitedSessions.has() checks session existence', () => {
    expect(exitedSessions.has('session-1')).toBe(false);
    markExited('session-1', 0);
    expect(exitedSessions.has('session-1')).toBe(true);
  });

  it('exitedSessions.get() returns exit info', () => {
    markExited('session-1', 42);
    const info = exitedSessions.get('session-1');
    expect(info).toBeDefined();
    expect(info!.exitCode).toBe(42);
  });

  it('exitedSessions.get() returns undefined for missing session', () => {
    expect(exitedSessions.get('missing')).toBeUndefined();
  });
});
