import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage before importing the store
let mockStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { mockStorage = {}; }),
});

import { get } from 'svelte/store';
import {
  globalEnvVars,
  getEffectiveEnv,
  addEnvVar,
  updateEnvVar,
  deleteEnvVar,
  ENV_STORAGE_KEY,
  validateEnvKey,
  resetEnvVars,
} from './envStore';

describe('envStore', () => {
  beforeEach(() => {
    mockStorage = {};
    vi.clearAllMocks();
    resetEnvVars();
  });

  describe('globalEnvVars store', () => {
    it('should initialize with empty env vars when localStorage is empty', () => {
      expect(get(globalEnvVars)).toEqual({});
    });

    it('should load env vars from localStorage on initialization', () => {
      mockStorage[ENV_STORAGE_KEY] = JSON.stringify({ FOO: 'bar', BAZ: 'qux' });
      resetEnvVars(); // re-initialize from mock storage
      expect(get(globalEnvVars)).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should handle corrupt localStorage gracefully', () => {
      mockStorage[ENV_STORAGE_KEY] = 'not-valid-json{{{';
      resetEnvVars();
      expect(get(globalEnvVars)).toEqual({});
    });
  });

  describe('CRUD operations', () => {
    it('should add an env var', () => {
      addEnvVar('MY_VAR', 'my_value');
      expect(get(globalEnvVars)).toEqual({ MY_VAR: 'my_value' });
    });

    it('should update an existing env var', () => {
      addEnvVar('MY_VAR', 'old_value');
      updateEnvVar('MY_VAR', 'new_value');
      expect(get(globalEnvVars)).toEqual({ MY_VAR: 'new_value' });
    });

    it('should delete an env var', () => {
      addEnvVar('MY_VAR', 'value');
      addEnvVar('OTHER', 'other');
      deleteEnvVar('MY_VAR');
      expect(get(globalEnvVars)).toEqual({ OTHER: 'other' });
    });

    it('should allow empty string values', () => {
      addEnvVar('EMPTY_VAR', '');
      expect(get(globalEnvVars)).toEqual({ EMPTY_VAR: '' });
    });

    it('should handle deleting non-existent key gracefully', () => {
      addEnvVar('EXISTS', 'value');
      deleteEnvVar('NOPE');
      expect(get(globalEnvVars)).toEqual({ EXISTS: 'value' });
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
    it('should return global env vars when no overrides', () => {
      addEnvVar('GLOBAL_VAR', 'global_value');
      const result = getEffectiveEnv({});
      expect(result).toEqual({ GLOBAL_VAR: 'global_value' });
    });

    it('should merge session overrides with global env vars', () => {
      addEnvVar('GLOBAL_VAR', 'global_value');
      const result = getEffectiveEnv({ SESSION_VAR: 'session_value' });
      expect(result).toEqual({
        GLOBAL_VAR: 'global_value',
        SESSION_VAR: 'session_value',
      });
    });

    it('should give session overrides precedence over global', () => {
      addEnvVar('SHARED_KEY', 'global_value');
      const result = getEffectiveEnv({ SHARED_KEY: 'session_value' });
      expect(result).toEqual({ SHARED_KEY: 'session_value' });
    });

    it('should return only session vars when no global vars', () => {
      const result = getEffectiveEnv({ ONLY_SESSION: 'value' });
      expect(result).toEqual({ ONLY_SESSION: 'value' });
    });

    it('should return empty object when no vars at all', () => {
      const result = getEffectiveEnv({});
      expect(result).toEqual({});
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
