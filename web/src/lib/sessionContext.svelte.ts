/**
 * Svelte context keys and helpers for sharing session manager and actions
 * across the component tree without prop drilling.
 *
 * Uses runes-compatible reactive boxes instead of Writable stores.
 */
import { getContext, setContext, hasContext } from 'svelte';
import type { SessionManager } from './SessionManager';
import type { SessionInfo } from './shared-protocol';
import type { DropZone } from './workspaceTypes';

export type { SessionInfo } from './shared-protocol';

// --- Context keys ---

const MANAGER_KEY = Symbol('terminar-manager');
const SESSIONS_KEY = Symbol('terminar-sessions');
const ACTIONS_KEY = Symbol('terminar-actions');
const PANE_ACTIONS_KEY = Symbol('terminar-pane-actions');

// --- Reactive box type ---

/** A simple reactive container compatible with Svelte 5 runes. */
export interface ReactiveBox<T> {
  value: T;
}

/**
 * Create a reactive box backed by $state.
 * Must be called inside a component's <script> block or a .svelte.ts file.
 */
export function reactiveBox<T>(initial: T): ReactiveBox<T> {
  let current = $state(initial);
  return {
    get value() { return current; },
    set value(v: T) { current = v; },
  };
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

export function setManagerContext(box: ReactiveBox<SessionManager | null>): void {
  setContext(MANAGER_KEY, box);
}

export function getManagerContext(): ReactiveBox<SessionManager | null> {
  if (hasContext(MANAGER_KEY)) {
    return getContext<ReactiveBox<SessionManager | null>>(MANAGER_KEY);
  }
  // Fallback for components rendered without context (e.g., tests)
  return reactiveBox<SessionManager | null>(null);
}

// --- Sessions context ---

export function setSessionsContext(box: ReactiveBox<SessionInfo[]>): void {
  setContext(SESSIONS_KEY, box);
}

export function getSessionsContext(): ReactiveBox<SessionInfo[]> {
  if (hasContext(SESSIONS_KEY)) {
    return getContext<ReactiveBox<SessionInfo[]>>(SESSIONS_KEY);
  }
  return reactiveBox<SessionInfo[]>([]);
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

// --- Pane actions interface ---

export interface PaneActions {
  drop(paneId: string, sessionId: string, dropZone: DropZone): void;
  paneDrop(sourcePaneId: string, targetPaneId: string, dropZone: DropZone): void;
  contextMenu(paneId: string, x: number, y: number): void;
  focus(paneId: string): void;
  detach(paneId: string): void;
  kill(paneId: string, sessionId: string): void;
  closePaneAction(paneId: string): void;
  splitHorizontal(paneId: string): void;
  splitVertical(paneId: string): void;
  commitResize(splitId: string, ratios: number[]): void;
  toggleFocus(paneId: string): void;
}

const NOOP_PANE_ACTIONS: PaneActions = {
  drop() {},
  paneDrop() {},
  contextMenu() {},
  focus() {},
  detach() {},
  kill() {},
  closePaneAction() {},
  splitHorizontal() {},
  splitVertical() {},
  commitResize() {},
  toggleFocus() {},
};

// --- Pane actions context ---

export function setPaneActionsContext(actions: PaneActions): void {
  setContext(PANE_ACTIONS_KEY, actions);
}

export function getPaneActionsContext(): PaneActions {
  if (hasContext(PANE_ACTIONS_KEY)) {
    return getContext<PaneActions>(PANE_ACTIONS_KEY);
  }
  return NOOP_PANE_ACTIONS;
}
