import { describe, it, expect, beforeEach } from 'vitest';
import { foregroundStore } from './foregroundStore.svelte';

describe('foregroundStore', () => {
  beforeEach(() => {
    for (const key of foregroundStore.processes.keys()) {
      foregroundStore.removeForeground(key);
    }
  });

  it('starts with empty processes map', () => {
    expect(foregroundStore.processes).toBeInstanceOf(Map);
    expect(foregroundStore.processes.size).toBe(0);
  });

  it('setForeground sets process for a session', () => {
    foregroundStore.setForeground('session-1', 'claude');
    expect(foregroundStore.processes.get('session-1')).toBe('claude');
  });

  it('getForeground returns the set process name', () => {
    foregroundStore.setForeground('session-1', 'claude');
    expect(foregroundStore.getForeground('session-1')).toBe('claude');
  });

  it('getForeground returns undefined for unknown sessions', () => {
    expect(foregroundStore.getForeground('unknown')).toBeUndefined();
  });

  it('setForeground with null sets null', () => {
    foregroundStore.setForeground('session-1', null);
    expect(foregroundStore.processes.has('session-1')).toBe(true);
    expect(foregroundStore.processes.get('session-1')).toBeNull();
  });

  it('removeForeground removes the session entry', () => {
    foregroundStore.setForeground('session-1', 'claude');
    foregroundStore.removeForeground('session-1');
    expect(foregroundStore.processes.has('session-1')).toBe(false);
  });

  it('multiple sessions have independent foreground processes', () => {
    foregroundStore.setForeground('session-1', 'claude');
    foregroundStore.setForeground('session-2', 'gemini');
    foregroundStore.setForeground('session-3', 'aider');
    expect(foregroundStore.getForeground('session-1')).toBe('claude');
    expect(foregroundStore.getForeground('session-2')).toBe('gemini');
    expect(foregroundStore.getForeground('session-3')).toBe('aider');
  });

  it('setForeground updates existing entry', () => {
    foregroundStore.setForeground('session-1', 'claude');
    foregroundStore.setForeground('session-1', 'gemini');
    expect(foregroundStore.getForeground('session-1')).toBe('gemini');
    expect(foregroundStore.processes.size).toBe(1);
  });
});
