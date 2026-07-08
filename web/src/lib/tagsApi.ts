import type { TagState } from './tagStore.svelte';

let baseUrl = 'http://localhost:6750';

export function setTagsApiBaseUrl(url: string) {
  baseUrl = url;
}

/** Overrides fetchTags()/saveTags() to go over a different transport (e.g.
 *  the tray's Unix-socket RPC) instead of HTTP `fetch`. */
export interface TagsTransport {
  get(): Promise<TagState | null>;
  put(tags: TagState): Promise<void>;
}
let _transportOverride: TagsTransport | null = null;

export function setTagsTransport(transport: TagsTransport | null): void {
  _transportOverride = transport;
}

/**
 * Fetch tags from the server.
 * Returns null if server is unreachable or has no saved tags (204).
 */
export async function fetchTags(): Promise<TagState | null> {
  if (_transportOverride) {
    try {
      return await _transportOverride.get();
    } catch (error) {
      console.warn('[TagsAPI] Transport failed to fetch tags:', error);
      return null;
    }
  }
  try {
    const response = await fetch(`${baseUrl}/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      console.warn('[TagsAPI] Server returned non-OK status:', response.status);
      return null;
    }

    const data = await response.json();
    return data as TagState;
  } catch (error) {
    console.warn('[TagsAPI] Failed to fetch tags from server:', error);
    return null;
  }
}

/**
 * Save tags to the server.
 * Throws if save fails.
 */
export async function saveTags(tags: TagState): Promise<void> {
  if (_transportOverride) return _transportOverride.put(tags);
  const response = await fetch(`${baseUrl}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tags),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to save tags: ${response.status} - ${errorText}`);
  }
}

/**
 * Initialize tags with the store.
 * Fetches from server and sets up the save callback.
 */
export async function initializeTags(
  store: {
    initialize: (tags: TagState | null) => void;
    setSaveCallback: (callback: (tags: TagState) => Promise<void>) => void;
  },
  httpUrl: string,
): Promise<void> {
  setTagsApiBaseUrl(httpUrl);
  store.setSaveCallback(saveTags);
  const serverTags = await fetchTags();
  store.initialize(serverTags);
}
