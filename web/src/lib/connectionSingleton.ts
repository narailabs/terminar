/**
 * Connection Singleton — ensures exactly one WebSocket connection exists.
 *
 * This module MUST be a plain .ts file (not .svelte) because Svelte 5 compiles
 * all <script> code inside the component constructor, so `let` variables in
 * .svelte files are per-instance, NOT module-scoped. A plain .ts module's
 * top-level variables ARE truly module-scoped and persist across HMR cycles
 * (Vite only invalidates the changed module, not its importers' state).
 *
 * The singleton pattern:
 * 1. `getManager()` returns the current active manager (or null)
 * 2. `createManager()` disconnects any existing manager, creates a new one
 * 3. `destroyManager()` disconnects and clears the current manager
 *
 * This prevents duplicate connections from:
 * - Svelte 5 HMR re-mounting components multiple times
 * - Vite HMR client reconnecting and triggering module re-evaluation
 * - Multiple App component instances running simultaneously
 */

import { WebSocketSessionManager } from './WebSocketSessionManager';
import type { SessionManager } from './SessionManager';

let _activeManager: SessionManager | null = null;
let _createCount = 0;

console.log('[connectionSingleton] Module loaded — this should appear exactly ONCE');

// Overrides how createManager() builds its SessionManager. Used by the tray
// (tray/src/renderer/terminal.ts) to swap in an IpcSessionManager backed by
// the Unix socket instead of a real WebSocket — the plain browser/dev-server
// path (pnpm dev:web) never sets this and is unaffected.
type ManagerFactory = (wsUrl: string, token?: string) => SessionManager;
let _managerFactory: ManagerFactory | null = null;

export function setManagerFactory(factory: ManagerFactory | null): void {
  _managerFactory = factory;
}

/** Get the current active connection manager, or null if none exists. */
export function getManager(): SessionManager | null {
  return _activeManager;
}

/**
 * Create a new WebSocket connection manager, replacing any existing one.
 * The old manager (if any) is disconnected and cleaned up.
 */
export function createManager(wsUrl: string, token?: string): SessionManager {
  _createCount++;
  const callNum = _createCount;
  console.log(`[connectionSingleton] createManager #${callNum} called, existing manager: ${_activeManager ? 'YES' : 'NO'}`);

  // Disconnect and clean up any existing manager
  if (_activeManager) {
    console.log(`[connectionSingleton] createManager #${callNum}: destroying previous manager`);
    _activeManager.removeAllListeners();
    _activeManager.disconnect();
    _activeManager = null;
  }

  _activeManager = _managerFactory
    ? _managerFactory(wsUrl, token)
    : token
      ? new WebSocketSessionManager(wsUrl, token)
      : new WebSocketSessionManager(wsUrl);
  console.log(`[connectionSingleton] createManager #${callNum}: new manager created`);
  return _activeManager;
}

/**
 * Disconnect and remove the current manager.
 * Safe to call even if no manager exists.
 */
export function destroyManager(): void {
  if (_activeManager) {
    _activeManager.removeAllListeners();
    _activeManager.disconnect();
    _activeManager = null;
  }
}

/**
 * Check if the given manager is still the active one.
 * Useful for async code that needs to verify it hasn't been superseded.
 */
export function isActiveManager(mgr: SessionManager | null): boolean {
  return mgr !== null && mgr === _activeManager;
}
