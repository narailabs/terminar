/**
 * Store for the currently focused (zoomed) pane ID.
 * When set, the pane repositions itself as a centered overlay.
 */
import type { PaneId } from './workspaceTypes';

let current = $state<PaneId | null>(null);

export const focusedPane = {
  get id() { return current; },
  set id(v: PaneId | null) { current = v; },
};
