import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ThemeState } from './themeStore.svelte';
import {
  setThemesApiBaseUrl,
  fetchThemes,
  saveThemes,
  initializeThemes,
} from './themesApi';

const mockThemeState: ThemeState = {
  uiMode: 'dark',
  activeUIThemeId: 'dark',
  activeTerminalThemeId: 'dark',
  terminalOverrides: {},
  customUIThemes: [],
  customTerminalThemes: [],
};

describe('themesApi', () => {
  beforeEach(() => {
    setThemesApiBaseUrl('http://localhost:6749');
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setThemesApiBaseUrl', () => {
    it('changes the base URL used in subsequent fetches', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockThemeState), { status: 200 })
      );

      setThemesApiBaseUrl('http://custom-host:9999');
      await fetchThemes();

      expect(fetch).toHaveBeenCalledWith('http://custom-host:9999/themes', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('fetchThemes', () => {
    it('returns parsed themes on success', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockThemeState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchThemes();

      expect(fetch).toHaveBeenCalledWith('http://localhost:6749/themes', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockThemeState);
    });

    it('returns null on 204 No Content (first run)', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 204 })
      );

      const result = await fetchThemes();
      expect(result).toBeNull();
    });

    it('returns null on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      const result = await fetchThemes();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[ThemesAPI] Server returned non-OK status:',
        500
      );
    });

    it('returns null on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await fetchThemes();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[ThemesAPI] Failed to fetch themes from server:',
        expect.any(TypeError)
      );
    });
  });

  describe('saveThemes', () => {
    it('resolves on success', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

      await expect(saveThemes(mockThemeState)).resolves.toBeUndefined();

      expect(fetch).toHaveBeenCalledWith('http://localhost:6749/themes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockThemeState),
      });
    });

    it('throws on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('Validation failed', { status: 400 })
      );

      await expect(saveThemes(mockThemeState)).rejects.toThrow(
        'Failed to save themes: 400 - Validation failed'
      );
    });

    it('throws on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Network error'));

      await expect(saveThemes(mockThemeState)).rejects.toThrow('Network error');
    });
  });

  describe('initializeThemes', () => {
    it('sets the base URL, wires save callback, fetches and initializes store', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockThemeState), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const store = {
        initialize: vi.fn(),
        setSaveCallback: vi.fn(),
      };

      await initializeThemes(store, 'http://myhost:4000');

      expect(fetch).toHaveBeenCalledWith('http://myhost:4000/themes', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(store.setSaveCallback).toHaveBeenCalledWith(saveThemes);
      expect(store.initialize).toHaveBeenCalledWith(mockThemeState);
    });

    it('initializes store with null when server returns 204', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(null, { status: 204 })
      );

      const store = {
        initialize: vi.fn(),
        setSaveCallback: vi.fn(),
      };

      await initializeThemes(store, 'http://localhost:6749');

      expect(store.setSaveCallback).toHaveBeenCalledWith(saveThemes);
      expect(store.initialize).toHaveBeenCalledWith(null);
    });

    it('initializes store with null when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      const store = {
        initialize: vi.fn(),
        setSaveCallback: vi.fn(),
      };

      await initializeThemes(store, 'http://localhost:6749');

      expect(store.setSaveCallback).toHaveBeenCalledWith(saveThemes);
      expect(store.initialize).toHaveBeenCalledWith(null);
    });
  });
});
