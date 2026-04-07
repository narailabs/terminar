import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage before importing the store
let mockStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { mockStorage = {}; }),
});

import {
  globalEnvVars,
  getEffectiveEnv,
  addEnvVar,
  updateEnvVar,
  deleteEnvVar,
  ENV_STORAGE_KEY,
  SESSION_ENV_STORAGE_KEY,
  validateEnvKey,
  resetEnvVars,
  addSessionEnvVar,
  deleteSessionEnvVar,
  getSessionEnvVars,
  cleanStaleSessionEnvVars,
} from './envStore.svelte';

describe('envStore', () => {
  beforeEach(() => {
    mockStorage = {};
    vi.clearAllMocks();
    resetEnvVars();
  });

  describe('globalEnvVars store', () => {
    it('should initialize with empty env vars when localStorage is empty', () => {
      expect(globalEnvVars.value).toEqual({});
    });

    it('should load env vars from localStorage on initialization', () => {
      mockStorage[ENV_STORAGE_KEY] = JSON.stringify({ FOO: 'bar', BAZ: 'qux' });
      resetEnvVars(); // re-initialize from mock storage
      expect(globalEnvVars.value).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should handle corrupt localStorage gracefully', () => {
      mockStorage[ENV_STORAGE_KEY] = 'not-valid-json{{{';
      resetEnvVars();
      expect(globalEnvVars.value).toEqual({});
    });
  });

  describe('CRUD operations', () => {
    it('should add an env var', () => {
      addEnvVar('MY_VAR', 'my_value');
      expect(globalEnvVars.value).toEqual({ MY_VAR: 'my_value' });
    });

    it('should update an existing env var', () => {
      addEnvVar('MY_VAR', 'old_value');
      updateEnvVar('MY_VAR', 'new_value');
      expect(globalEnvVars.value).toEqual({ MY_VAR: 'new_value' });
    });

    it('should delete an env var', () => {
      addEnvVar('MY_VAR', 'value');
      addEnvVar('OTHER', 'other');
      deleteEnvVar('MY_VAR');
      expect(globalEnvVars.value).toEqual({ OTHER: 'other' });
    });

    it('should allow empty string values', () => {
      addEnvVar('EMPTY_VAR', '');
      expect(globalEnvVars.value).toEqual({ EMPTY_VAR: '' });
    });

    it('should handle deleting non-existent key gracefully', () => {
      addEnvVar('EXISTS', 'value');
      deleteEnvVar('NOPE');
      expect(globalEnvVars.value).toEqual({ EXISTS: 'value' });
    });
  });

  describe('auto-persist to localStorage', () => {
    it('should save to localStorage when adding env var', () => {
      addEnvVar('PERSIST_ME', 'value');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        ENV_STORAGE_KEY,
        JSON.stringify({ PERSIST_ME: 'value' })
      );
    });

    it('should save to localStorage when updating env var', () => {
      addEnvVar('KEY', 'old');
      vi.clearAllMocks();
      updateEnvVar('KEY', 'new');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        ENV_STORAGE_KEY,
        JSON.stringify({ KEY: 'new' })
      );
    });

    it('should save to localStorage when deleting env var', () => {
      addEnvVar('KEY', 'val');
      vi.clearAllMocks();
      deleteEnvVar('KEY');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        ENV_STORAGE_KEY,
        JSON.stringify({})
      );
    });
  });

  describe('getEffectiveEnv', () => {
    it('should return global env vars when no session id', () => {
      addEnvVar('GLOBAL_VAR', 'global_value');
      const result = getEffectiveEnv();
      expect(result).toEqual({ GLOBAL_VAR: 'global_value' });
    });

    it('should merge session vars with global env vars', () => {
      addEnvVar('GLOBAL_VAR', 'global_value');
      addSessionEnvVar('sess-1', 'SESSION_VAR', 'session_value');
      const result = getEffectiveEnv('sess-1');
      expect(result).toEqual({
        GLOBAL_VAR: 'global_value',
        SESSION_VAR: 'session_value',
      });
    });

    it('should give session vars precedence over global', () => {
      addEnvVar('SHARED_KEY', 'global_value');
      addSessionEnvVar('sess-1', 'SHARED_KEY', 'session_value');
      const result = getEffectiveEnv('sess-1');
      expect(result).toEqual({ SHARED_KEY: 'session_value' });
    });

    it('should return only global vars for session with no per-session vars', () => {
      addEnvVar('GLOBAL_VAR', 'value');
      const result = getEffectiveEnv('sess-none');
      expect(result).toEqual({ GLOBAL_VAR: 'value' });
    });

    it('should return empty object when no vars at all', () => {
      const result = getEffectiveEnv();
      expect(result).toEqual({});
    });
  });

  describe('per-session env vars', () => {
    it('should add and retrieve session env vars', () => {
      addSessionEnvVar('sess-1', 'FOO', 'bar');
      expect(getSessionEnvVars('sess-1')).toEqual({ FOO: 'bar' });
    });

    it('should delete session env vars', () => {
      addSessionEnvVar('sess-1', 'FOO', 'bar');
      addSessionEnvVar('sess-1', 'BAZ', 'qux');
      deleteSessionEnvVar('sess-1', 'FOO');
      expect(getSessionEnvVars('sess-1')).toEqual({ BAZ: 'qux' });
    });

    it('should return empty object for unknown session', () => {
      expect(getSessionEnvVars('unknown')).toEqual({});
    });

    it('should persist session env vars to localStorage', () => {
      addSessionEnvVar('sess-1', 'KEY', 'val');
      expect(localStorage.setItem).toHaveBeenCalledWith(
        SESSION_ENV_STORAGE_KEY,
        expect.any(String)
      );
    });

    it('should clean stale session env vars', () => {
      addSessionEnvVar('sess-1', 'A', '1');
      addSessionEnvVar('sess-2', 'B', '2');
      cleanStaleSessionEnvVars(new Set(['sess-1']));
      expect(getSessionEnvVars('sess-1')).toEqual({ A: '1' });
      expect(getSessionEnvVars('sess-2')).toEqual({});
    });
  });

  describe('validateEnvKey', () => {
    it('should reject empty key', () => {
      expect(validateEnvKey('')).toBe('Key cannot be empty');
    });

    it('should reject key with spaces', () => {
      expect(validateEnvKey('MY VAR')).toBe('Key cannot contain spaces');
    });

    it('should reject key with equals sign', () => {
      expect(validateEnvKey('MY=VAR')).toBe('Key cannot contain "="');
    });

    it('should accept valid key', () => {
      expect(validateEnvKey('MY_VAR')).toBeNull();
    });

    it('should accept key with numbers and underscores', () => {
      expect(validateEnvKey('MY_VAR_123')).toBeNull();
    });

    it('should reject key with only spaces', () => {
      expect(validateEnvKey('   ')).toBe('Key cannot be empty');
    });
  });
});
