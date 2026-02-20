/**
 * Foreground Process Store for terminar
 *
 * Tracks the foreground process name for each terminal session.
 * Used by the UI to display agent icons/badges.
 */

let processes = $state<Map<string, string | null>>(new Map());

export const foregroundStore = {
  get processes() {
    return processes;
  },

  /** Set the foreground process for a session. */
  setForeground(sessionId: string, processName: string | null): void {
    const next = new Map(processes);
    next.set(sessionId, processName);
    processes = next;
  },

  /** Get the foreground process name for a session. */
  getForeground(sessionId: string): string | null | undefined {
    return processes.get(sessionId);
  },

  /** Remove a session from tracking. */
  removeForeground(sessionId: string): void {
    const next = new Map(processes);
    next.delete(sessionId);
    processes = next;
  },
};
