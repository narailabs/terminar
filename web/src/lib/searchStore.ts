/**
 * Search state store for terminar
 *
 * Manages the search UI state including:
 * - Open/close state
 * - Current search query
 * - Match count and current match index
 * - Case sensitivity and regex toggle
 */

import { writable, get } from 'svelte/store';

export interface SearchState {
  isOpen: boolean;
  paneId: string | null;
  query: string;
  currentMatch: number;  // 1-indexed, 0 means no match
  totalMatches: number;
  caseSensitive: boolean;
  useRegex: boolean;
}

const INITIAL_STATE: SearchState = {
  isOpen: false,
  paneId: null,
  query: '',
  currentMatch: 0,
  totalMatches: 0,
  caseSensitive: false,
  useRegex: false,
};

export function createSearchStore() {
  const { subscribe, set, update } = writable<SearchState>({ ...INITIAL_STATE });

  return {
    subscribe,

    get(): SearchState {
      return get({ subscribe });
    },

    open(paneId?: string) {
      update(s => ({ ...s, isOpen: true, paneId: paneId ?? s.paneId }));
    },

    close() {
      set({ ...INITIAL_STATE });
    },

    setQuery(query: string) {
      update(s => ({
        ...s,
        query,
        // Reset match info when query changes
        currentMatch: 0,
        totalMatches: 0,
      }));
    },

    setMatchInfo(currentMatch: number, totalMatches: number) {
      update(s => ({ ...s, currentMatch, totalMatches }));
    },

    toggleCaseSensitive() {
      update(s => ({
        ...s,
        caseSensitive: !s.caseSensitive,
        // Reset match info on mode change
        currentMatch: 0,
        totalMatches: 0,
      }));
    },

    toggleRegex() {
      update(s => ({
        ...s,
        useRegex: !s.useRegex,
        // Reset match info on mode change
        currentMatch: 0,
        totalMatches: 0,
      }));
    },
  };
}

/**
 * Global search store instance.
 */
export const searchStore = createSearchStore();
