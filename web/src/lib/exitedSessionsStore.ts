/**
 * Exited sessions store for terminar
 *
 * Tracks which terminal sessions have exited, along with their exit codes
 * and timestamps. Used to display exited session UI indicators.
 */

import { writable, get } from 'svelte/store';

export interface ExitedSessionInfo {
  sessionId: string;
  exitCode: number | null;
  exitedAt: number; // timestamp
}

/**
 * Svelte writable store holding a Map of session ID to exit info.
 */
export const exitedSessions = writable<Map<string, ExitedSessionInfo>>(new Map());

/**
 * Mark a session as exited with the given exit code.
 */
export function markExited(sessionId: string, exitCode: number | null): void {
  exitedSessions.update((sessions) => {
    const next = new Map(sessions);
    next.set(sessionId, {
      sessionId,
      exitCode,
      exitedAt: Date.now(),
    });
    return next;
  });
}

/**
 * Check if a session has exited.
 */
export function isExited(sessionId: string): boolean {
  return get(exitedSessions).has(sessionId);
}

/**
 * Get the exit info for a session, or undefined if it hasn't exited.
 */
export function getExitInfo(sessionId: string): ExitedSessionInfo | undefined {
  return get(exitedSessions).get(sessionId);
}

/**
 * Remove a session from the exited sessions store (e.g., when closing/cleaning up).
 */
export function removeExited(sessionId: string): void {
  exitedSessions.update((sessions) => {
    const next = new Map(sessions);
    next.delete(sessionId);
    return next;
  });
}
