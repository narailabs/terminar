/**
 * Exited sessions store for terminar
 *
 * Tracks which terminal sessions have exited, along with their exit codes
 * and timestamps. Used to display exited session UI indicators.
 */

export interface ExitedSessionInfo {
  sessionId: string;
  exitCode: number | null;
  exitedAt: number; // timestamp
}

let sessions = $state<Map<string, ExitedSessionInfo>>(new Map());

export const exitedSessions = {
  get map() {
    return sessions;
  },

  has(sessionId: string): boolean {
    return sessions.has(sessionId);
  },

  get(sessionId: string): ExitedSessionInfo | undefined {
    return sessions.get(sessionId);
  },
};

/** Mark a session as exited with the given exit code. */
export function markExited(sessionId: string, exitCode: number | null): void {
  const next = new Map(sessions);
  next.set(sessionId, {
    sessionId,
    exitCode,
    exitedAt: Date.now(),
  });
  sessions = next;
}

/** Check if a session has exited. */
export function isExited(sessionId: string): boolean {
  return sessions.has(sessionId);
}

/** Get the exit info for a session. */
export function getExitInfo(sessionId: string): ExitedSessionInfo | undefined {
  return sessions.get(sessionId);
}

/** Remove a session from the exited sessions store. */
export function removeExited(sessionId: string): void {
  const next = new Map(sessions);
  next.delete(sessionId);
  sessions = next;
}
