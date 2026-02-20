import type { TerminalSettings } from './settingsStore.svelte';

/**
 * API client for terminal settings
 * Handles GET/PUT requests to the server with localStorage fallback
 */

let baseUrl = 'http://localhost:6749';

/**
 * Configure the API base URL
 */
export function setSettingsApiBaseUrl(url: string) {
  baseUrl = url;
}

/**
 * Fetch settings from the server
 * Falls back to null if server is unreachable (caller should use cache/defaults)
 */
export async function fetchSettings(): Promise<TerminalSettings | null> {
  try {
    const response = await fetch(`${baseUrl}/settings`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn('[SettingsAPI] Server returned non-OK status:', response.status);
      return null;
    }

    const data = await response.json();
    return data as TerminalSettings;
  } catch (error) {
    console.warn('[SettingsAPI] Failed to fetch settings from server:', error);
    return null;
  }
}

/**
 * Save settings to the server
 * Throws if save fails (caller should handle error)
 */
export async function saveSettings(settings: TerminalSettings): Promise<void> {
  const response = await fetch(`${baseUrl}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to save settings: ${response.status} - ${errorText}`);
  }
}

/**
 * Initialize settings with the store
 * Fetches from server and sets up the save callback
 */
export async function initializeSettings(
  store: {
    initialize: (settings: TerminalSettings | null) => void;
    setSaveCallback: (callback: (settings: TerminalSettings) => Promise<void>) => void;
  },
  httpUrl: string
): Promise<void> {
  // Set the base URL
  setSettingsApiBaseUrl(httpUrl);

  // Set up the save callback
  store.setSaveCallback(saveSettings);

  // Fetch settings from server
  const serverSettings = await fetchSettings();

  // Initialize store with server settings (or null to use cache/defaults)
  store.initialize(serverSettings);
}
