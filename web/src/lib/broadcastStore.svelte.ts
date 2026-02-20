import type { SessionManager } from './SessionManager';

let enabled = $state(false);
let targets = $state<Set<string>>(new Set());

/**
 * Internal reference to the session manager for sending input
 */
let sessionManager: SessionManager | null = null;

/**
 * Broadcast state - reactive getters for enabled flag and target set
 */
export const broadcastEnabled = {
  get value() {
    return enabled;
  },
  set value(v: boolean) {
    enabled = v;
  },
};

export const broadcastTargets = {
  get value() {
    return targets;
  },
};

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
  const next = new Set(targets);
  next.add(sessionId);
  targets = next;
}

/**
 * Remove a session ID from the broadcast targets
 */
export function removeTarget(sessionId: string): void {
  const next = new Set(targets);
  next.delete(sessionId);
  targets = next;
}

/**
 * Toggle a session ID in/out of the broadcast targets
 */
export function toggleTarget(sessionId: string): void {
  const next = new Set(targets);
  if (next.has(sessionId)) {
    next.delete(sessionId);
  } else {
    next.add(sessionId);
  }
  targets = next;
}

/**
 * Clear all broadcast targets
 */
export function clearTargets(): void {
  targets = new Set();
}

/**
 * Check if a session ID is currently a broadcast target
 */
export function isTarget(sessionId: string): boolean {
  return targets.has(sessionId);
}

/**
 * Send input data to all broadcast target sessions.
 * Uses the session manager's sendInput method for each target.
 */
export function broadcastInput(data: string): void {
  if (!sessionManager) return;

  for (const sessionId of targets) {
    sessionManager.sendInput(sessionId, data);
  }
}
