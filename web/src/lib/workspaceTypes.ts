/**
 * Workspace types for split-pane terminal layouts
 */

/** Session info from the server */
export interface SessionInfo {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  started_at: string;
}

/** Unique identifier for panes, tabs, etc. */
export type PaneId = string;
export type TabId = string;
export type SessionId = string;

/** Split orientation */
export type SplitDirection = 'horizontal' | 'vertical';

/** Drop zone for drag & drop */
export type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

/**
 * A pane displays a single terminal session
 */
export interface Pane {
  type: 'pane';
  id: PaneId;
  sessionId: SessionId | null; // null if no session assigned
}

/**
 * A split container holds multiple children (panes or nested splits)
 */
export interface SplitContainer {
  type: 'split';
  id: string;
  direction: SplitDirection;
  children: SplitNode[];
  /** Ratios for each child (must sum to 1.0) */
  ratios: number[];
}

/** A node in the split tree is either a Pane or a SplitContainer */
export type SplitNode = Pane | SplitContainer;

/**
 * A tab represents a named workspace view with its own split layout
 */
export interface Tab {
  id: TabId;
  name: string;
  /** Root of the split tree */
  root: SplitNode;
}

/**
 * The complete workspace state
 */
export interface Workspace {
  tabs: Tab[];
  activeTabId: TabId;
}

/**
 * A layout template (structure without session assignments)
 */
export interface LayoutTemplate {
  id: string;
  name: string;
  /** Root structure (panes will have sessionId: null) */
  root: SplitNode;
  createdAt: string;
}

/**
 * Helper to create a new pane
 */
export function createPane(sessionId: SessionId | null = null): Pane {
  return {
    type: 'pane',
    id: crypto.randomUUID(),
    sessionId,
  };
}

/**
 * Helper to create a split container
 */
export function createSplit(
  direction: SplitDirection,
  children: SplitNode[],
  ratios?: number[]
): SplitContainer {
  const defaultRatios = children.map(() => 1 / children.length);
  return {
    type: 'split',
    id: crypto.randomUUID(),
    direction,
    children,
    ratios: ratios || defaultRatios,
  };
}

/**
 * Helper to create a new tab
 */
export function createTab(name: string, sessionId?: SessionId): Tab {
  return {
    id: crypto.randomUUID(),
    name,
    root: createPane(sessionId || null),
  };
}

/**
 * Helper to create a default workspace
 */
export function createDefaultWorkspace(initialSessionId?: SessionId): Workspace {
  return {
    tabs: [createTab('Terminal 1', initialSessionId)],
    activeTabId: '', // Will be set to first tab's ID
  };
}

/**
 * Find a pane by ID in the split tree
 */
export function findPane(node: SplitNode, paneId: PaneId): Pane | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}

/**
 * Find the parent split container of a node
 */
export function findParent(
  root: SplitNode,
  targetId: string
): { parent: SplitContainer; index: number } | null {
  if (root.type === 'pane') return null;

  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.id === targetId) {
      return { parent: root, index: i };
    }
    if (child.type === 'split') {
      const found = findParent(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get all panes in the split tree
 */
export function getAllPanes(node: SplitNode): Pane[] {
  if (node.type === 'pane') {
    return [node];
  }
  return node.children.flatMap(getAllPanes);
}

/**
 * Get all session IDs used in a workspace
 */
export function getWorkspaceSessionIds(workspace: Workspace): SessionId[] {
  const ids = new Set<SessionId>();
  for (const tab of workspace.tabs) {
    for (const pane of getAllPanes(tab.root)) {
      if (pane.sessionId) {
        ids.add(pane.sessionId);
      }
    }
  }
  return Array.from(ids);
}
