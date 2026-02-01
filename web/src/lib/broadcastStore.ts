import { writable, get } from 'svelte/store';
import type { SessionManager } from './SessionManager';

/**
 * Whether broadcast mode is enabled (shows UI controls)
 */
export const broadcastEnabled = writable<boolean>(false);

/**
 * Set of session IDs that are broadcast targets
 */
export const broadcastTargets = writable<Set<string>>(new Set());

/**
 * Internal reference to the session manager for sending input
 */
let sessionManager: SessionManager | null = null;

/**
 * Set the session manager instance used by broadcastInput.
 * Call this from App.svelte when the manager is established.
 */
export function setSessionManager(manager: SessionManager | null): void {
  sessionManager = manager;
}

/**
 * Add a session ID to the broadcast targets
 */
export function addTarget(sessionId: string): void {
  broadcastTargets.update(targets => {
    const next = new Set(targets);
    next.add(sessionId);
    return next;
  });
}

/**
 * Remove a session ID from the broadcast targets
 */
export function removeTarget(sessionId: string): void {
  broadcastTargets.update(targets => {
    const next = new Set(targets);
    next.delete(sessionId);
    return next;
  });
}

/**
 * Toggle a session ID in/out of the broadcast targets
 */
export function toggleTarget(sessionId: string): void {
  broadcastTargets.update(targets => {
    const next = new Set(targets);
    if (next.has(sessionId)) {
      next.delete(sessionId);
    } else {
      next.add(sessionId);
    }
    return next;
  });
}

/**
 * Clear all broadcast targets
 */
export function clearTargets(): void {
  broadcastTargets.set(new Set());
}

/**
 * Check if a session ID is currently a broadcast target
 */
export function isTarget(sessionId: string): boolean {
  return get(broadcastTargets).has(sessionId);
}

/**
 * Send input data to all broadcast target sessions.
 * Uses the session manager's sendInput method for each target.
 */
export function broadcastInput(data: string): void {
  if (!sessionManager) return;

  const targets = get(broadcastTargets);
  for (const sessionId of targets) {
    sessionManager.sendInput(sessionId, data);
  }
}
