/**
 * Terminal Title Store
 *
 * Tracks OSC 2 terminal titles per session, so the sidebar
 * can display them alongside session names.
 */

let titles = $state<Map<string, string>>(new Map());

export const titleStore = {
  get titles() {
    return titles;
  },

  setTitle(sessionId: string, title: string): void {
    const next = new Map(titles);
    if (title) {
      next.set(sessionId, title);
    } else {
      next.delete(sessionId);
    }
    titles = next;
  },

  removeTitle(sessionId: string): void {
    const next = new Map(titles);
    next.delete(sessionId);
    titles = next;
  },
};
