/**
 * Terminal Title Store
 *
 * Tracks OSC 2 terminal titles per session, so the sidebar
 * can display them alongside session names.
 */

import { writable } from 'svelte/store';

export interface TitleState {
  titles: Map<string, string>;
}

function createTitleStore() {
  const { subscribe, update } = writable<TitleState>({
    titles: new Map(),
  });

  return {
    subscribe,

    setTitle(sessionId: string, title: string): void {
      update((state) => {
        const next = new Map(state.titles);
        if (title) {
          next.set(sessionId, title);
        } else {
          next.delete(sessionId);
        }
        return { titles: next };
      });
    },

    removeTitle(sessionId: string): void {
      update((state) => {
        const next = new Map(state.titles);
        next.delete(sessionId);
        return { titles: next };
      });
    },
  };
}

export const titleStore = createTitleStore();
