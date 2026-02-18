/**
 * Activity state store for terminar
 *
 * Tracks per-session activity indicators (activity, bell, silence).
 * Used to show visual indicators on tabs and sidebar when a session
 * has new output or events while not being viewed.
 */

import { writable, get } from 'svelte/store';

export type ActivityType = 'activity' | 'bell' | 'silence';

export interface ActivityState {
  /** Map of sessionId -> latest activity type */
  activities: Map<string, ActivityType>;
}

const INITIAL_STATE: ActivityState = {
  activities: new Map(),
};

export function createActivityStore() {
  const { subscribe, update } = writable<ActivityState>({
    activities: new Map(INITIAL_STATE.activities),
  });

  return {
    subscribe,

    /** Set activity indicator for a session */
    setActivity(sessionId: string, activityType: ActivityType): void {
      update(s => {
        const next = new Map(s.activities);
        next.set(sessionId, activityType);
        return { activities: next };
      });
    },

    /** Clear activity indicator when user views the session */
    clearActivity(sessionId: string): void {
      update(s => {
        const next = new Map(s.activities);
        next.delete(sessionId);
        return { activities: next };
      });
    },

    /** Get current activity type for a session */
    getActivity(sessionId: string): ActivityType | undefined {
      return get({ subscribe }).activities.get(sessionId);
    },
  };
}

/** Global activity store instance */
export const activityStore = createActivityStore();
