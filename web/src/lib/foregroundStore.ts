/**
 * Foreground Process Store for termiNar (F9b)
 *
 * Tracks the foreground process name for each terminal session.
 * Used by the UI to display agent icons/badges.
 */

import { writable, get } from 'svelte/store';

export interface ForegroundState {
  processes: Map<string, string | null>;
}

export function createForegroundStore() {
  const { subscribe, update } = writable<ForegroundState>({
    processes: new Map(),
  });

  return {
    subscribe,

    /**
     * Set the foreground process for a session.
     */
    setForeground(sessionId: string, processName: string | null): void {
      update((state) => {
        const next = new Map(state.processes);
        next.set(sessionId, processName);
        return { processes: next };
      });
    },

    /**
     * Get the foreground process name for a session.
     * Returns undefined if session is not tracked.
     */
    getForeground(sessionId: string): string | null | undefined {
      const state = get({ subscribe });
      return state.processes.get(sessionId);
    },

    /**
     * Remove a session from tracking (e.g., when session is closed).
     */
    removeForeground(sessionId: string): void {
      update((state) => {
        const next = new Map(state.processes);
        next.delete(sessionId);
        return { processes: next };
      });
    },
  };
}

/**
 * Global foreground store instance.
 */
export const foregroundStore = createForegroundStore();
