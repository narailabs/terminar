import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveToken, loadToken, clearToken, TOKEN_KEY } from './tokenStore';

describe('tokenStore', () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
      removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
    });
  });

  it('should save a token to localStorage', () => {
    saveToken('my-secret-token');
    expect(localStorage.setItem).toHaveBeenCalledWith(TOKEN_KEY, 'my-secret-token');
  });

  it('should load a token from localStorage', () => {
    mockStorage[TOKEN_KEY] = 'stored-token';
    const token = loadToken();
    expect(token).toBe('stored-token');
  });

  it('should return null when no token is stored', () => {
    const token = loadToken();
    expect(token).toBeNull();
  });

  it('should clear the token from localStorage', () => {
    mockStorage[TOKEN_KEY] = 'to-be-cleared';
    clearToken();
    expect(localStorage.removeItem).toHaveBeenCalledWith(TOKEN_KEY);
  });

  it('should round-trip save and load', () => {
    saveToken('roundtrip-token');
    const loaded = loadToken();
    expect(loaded).toBe('roundtrip-token');
  });
});
