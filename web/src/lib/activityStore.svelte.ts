/**
 * Activity state store for terminar
 *
 * Tracks per-session activity indicators (activity, bell, silence).
 * Used to show visual indicators on tabs and sidebar when a session
 * has new output or events while not being viewed.
 */

export type ActivityType = 'activity' | 'bell' | 'silence';

let activities = $state<Map<string, ActivityType>>(new Map());

export const activityStore = {
  get activities() {
    return activities;
  },

  /** Set activity indicator for a session */
  setActivity(sessionId: string, activityType: ActivityType): void {
    const next = new Map(activities);
    next.set(sessionId, activityType);
    activities = next;
  },

  /** Clear activity indicator when user views the session */
  clearActivity(sessionId: string): void {
    const next = new Map(activities);
    next.delete(sessionId);
    activities = next;
  },

  /** Get current activity type for a session */
  getActivity(sessionId: string): ActivityType | undefined {
    return activities.get(sessionId);
  },
};
