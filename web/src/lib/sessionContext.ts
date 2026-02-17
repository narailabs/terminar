/**
 * Svelte context keys and helpers for sharing session manager and actions
 * across the component tree without prop drilling.
 */
import { getContext, setContext, hasContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import type { SessionManager } from './SessionManager';

// --- Context keys ---

const MANAGER_KEY = Symbol('terminar-manager');
const SESSIONS_KEY = Symbol('terminar-sessions');
const ACTIONS_KEY = Symbol('terminar-actions');

// --- Session info (local re-export for convenience) ---

export interface SessionInfo {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  started_at: string;
}

// --- Actions interface ---

export interface AppActions {
  createNewTerminal(targetPaneId?: string): void;
  closeTerminal(sessionId: string): void;
  renameTerminal(sessionId: string, newName: string): void;
  toggleSidebar(): void;
}

// No-op actions for when context is not available (e.g., unit tests)
const NOOP_ACTIONS: AppActions = {
  createNewTerminal() {},
  closeTerminal() {},
  renameTerminal() {},
  toggleSidebar() {},
};

// --- Manager context ---

export function setManagerContext(store: Writable<SessionManager | null>): void {
  setContext(MANAGER_KEY, store);
}

export function getManagerContext(): Writable<SessionManager | null> {
  if (hasContext(MANAGER_KEY)) {
    return getContext<Writable<SessionManager | null>>(MANAGER_KEY);
  }
  // Fallback for components rendered without context (e.g., tests)
  return writable(null);
}

// --- Sessions context ---

export function setSessionsContext(store: Writable<SessionInfo[]>): void {
  setContext(SESSIONS_KEY, store);
}

export function getSessionsContext(): Writable<SessionInfo[]> {
  if (hasContext(SESSIONS_KEY)) {
    return getContext<Writable<SessionInfo[]>>(SESSIONS_KEY);
  }
  return writable([]);
}

// --- Actions context ---

export function setActionsContext(actions: AppActions): void {
  setContext(ACTIONS_KEY, actions);
}

export function getActionsContext(): AppActions {
  if (hasContext(ACTIONS_KEY)) {
    return getContext<AppActions>(ACTIONS_KEY);
  }
  return NOOP_ACTIONS;
}
