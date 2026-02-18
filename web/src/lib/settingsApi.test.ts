import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TerminalSettings } from './settingsStore';
import {
  setSettingsApiBaseUrl,
  fetchSettings,
  saveSettings,
  initializeSettings,
} from './settingsApi';

const mockSettings: TerminalSettings = {
  fontSize: 14,
  fontFamily: 'monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.2,
  showPaneTitleBars: true,
  autoScroll: true,
};

describe('settingsApi', () => {
  beforeEach(() => {
    setSettingsApiBaseUrl('http://localhost:6749');
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setSettingsApiBaseUrl', () => {
    it('changes the base URL used in subsequent fetches', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockSettings), { status: 200 })
      );

      setSettingsApiBaseUrl('http://custom-host:9999');
      await fetchSettings();

      expect(fetch).toHaveBeenCalledWith('http://custom-host:9999/settings', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('fetchSettings', () => {
    it('returns parsed settings on success', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockSettings), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await fetchSettings();

      expect(fetch).toHaveBeenCalledWith('http://localhost:6749/settings', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual(mockSettings);
    });

    it('returns null on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      const result = await fetchSettings();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[SettingsAPI] Server returned non-OK status:',
        500
      );
    });

    it('returns null on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await fetchSettings();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[SettingsAPI] Failed to fetch settings from server:',
        expect.any(TypeError)
      );
    });
  });

  describe('saveSettings', () => {
    it('resolves on success', async () => {
      vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }));

      await expect(saveSettings(mockSettings)).resolves.toBeUndefined();

      expect(fetch).toHaveBeenCalledWith('http://localhost:6749/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockSettings),
      });
    });

    it('throws on non-OK response', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('Validation failed', { status: 400 })
      );

      await expect(saveSettings(mockSettings)).rejects.toThrow(
        'Failed to save settings: 400 - Validation failed'
      );
    });

    it('throws on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Network error'));

      await expect(saveSettings(mockSettings)).rejects.toThrow('Network error');
    });
  });

  describe('initializeSettings', () => {
    it('sets the base URL, wires save callback, fetches and initializes store', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response(JSON.stringify(mockSettings), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const store = {
        initialize: vi.fn(),
        setSaveCallback: vi.fn(),
      };

      await initializeSettings(store, 'http://myhost:4000');

      // Verify base URL was updated by checking the fetch call
      expect(fetch).toHaveBeenCalledWith('http://myhost:4000/settings', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      // Verify save callback was wired
      expect(store.setSaveCallback).toHaveBeenCalledWith(saveSettings);

      // Verify store was initialized with fetched settings
      expect(store.initialize).toHaveBeenCalledWith(mockSettings);
    });

    it('initializes store with null when fetch returns non-OK', async () => {
      vi.mocked(fetch).mockResolvedValue(
        new Response('Not Found', { status: 404 })
      );

      const store = {
        initialize: vi.fn(),
        setSaveCallback: vi.fn(),
      };

      await initializeSettings(store, 'http://localhost:6749');

      expect(store.setSaveCallback).toHaveBeenCalledWith(saveSettings);
      expect(store.initialize).toHaveBeenCalledWith(null);
    });

    it('initializes store with null when fetch throws a network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

      const store = {
        initialize: vi.fn(),
        setSaveCallback: vi.fn(),
      };

      await initializeSettings(store, 'http://localhost:6749');

      expect(store.setSaveCallback).toHaveBeenCalledWith(saveSettings);
      expect(store.initialize).toHaveBeenCalledWith(null);
    });
  });
});
