import type { ThemeState } from './themeStore.svelte';

let baseUrl = 'http://localhost:6750';

export function setThemesApiBaseUrl(url: string) {
  baseUrl = url;
}

/** Overrides fetchThemes()/saveThemes() to go over a different transport
 *  (e.g. the tray's Unix-socket RPC) instead of HTTP `fetch`. */
export interface ThemesTransport {
  get(): Promise<ThemeState | null>;
  put(themes: ThemeState): Promise<void>;
}
let _transportOverride: ThemesTransport | null = null;

export function setThemesTransport(transport: ThemesTransport | null): void {
  _transportOverride = transport;
}

/**
 * Fetch themes from the server.
 * Returns null if server is unreachable or has no saved themes (204).
 */
export async function fetchThemes(): Promise<ThemeState | null> {
  if (_transportOverride) return _transportOverride.get();
  try {
    const response = await fetch(`${baseUrl}/themes`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      console.warn('[ThemesAPI] Server returned non-OK status:', response.status);
      return null;
    }

    const data = await response.json();
    return data as ThemeState;
  } catch (error) {
    console.warn('[ThemesAPI] Failed to fetch themes from server:', error);
    return null;
  }
}

/**
 * Save themes to the server.
 * Throws if save fails.
 */
export async function saveThemes(themes: ThemeState): Promise<void> {
  if (_transportOverride) return _transportOverride.put(themes);
  const response = await fetch(`${baseUrl}/themes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(themes),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to save themes: ${response.status} - ${errorText}`);
  }
}

/**
 * Initialize themes with the store.
 * Fetches from server and sets up the save callback.
 */
export async function initializeThemes(
  store: {
    initialize: (themes: ThemeState | null) => void;
    setSaveCallback: (callback: (themes: ThemeState) => Promise<void>) => void;
  },
  httpUrl: string,
): Promise<void> {
  setThemesApiBaseUrl(httpUrl);
  store.setSaveCallback(saveThemes);
  const serverThemes = await fetchThemes();
  store.initialize(serverThemes);
}
