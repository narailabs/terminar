import type { PaneId } from './workspaceTypes';

let current = $state<PaneId | null>(null);

export const activePaneStore = {
  get id() { return current; },
  set id(v: PaneId | null) { current = v; },
};
