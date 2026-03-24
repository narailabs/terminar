import { writable, derived, get, readonly } from 'svelte/store';
import type {
  Workspace,
  TabId,
  PaneId,
  SessionId,
  SplitNode,
  SplitDirection,
  LayoutTemplate,
  DropZone,
} from './workspaceTypes';
import {
  createTab,
  createPane,
  createSplit,
  createDefaultWorkspace,
  findPane,
  findParent,
  getAllPanes,
} from './workspaceTypes';

const STORAGE_KEY = 'workspace-state';

/**
 * Migrate a workspace loaded from persistence to ensure all tabs have sessionOrder.
 */
function migrateWorkspace(workspace: Workspace): Workspace {
  for (const tab of workspace.tabs) {
    if (!tab.sessionOrder) {
      // Migrate: derive sessionOrder from pane tree
      tab.sessionOrder = getAllPanes(tab.root)
        .filter((p) => p.sessionId)
        .map((p) => p.sessionId!);
    }
  }
  return workspace;
}

/**
 * Load workspace from localStorage (fallback cache)
 */
function loadFromCache(): Workspace | null {
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      return migrateWorkspace(JSON.parse(cached));
    }
  } catch (e) {
    console.warn('[Workspace] Failed to load from cache:', e);
  }
  return null;
}

/**
 * Save workspace to localStorage (cache)
 */
function saveToCache(workspace: Workspace): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch (e) {
    console.warn('[Workspace] Failed to save to cache:', e);
  }
}

/**
 * Create the workspace store
 */
// Tracks which sessions are "new" (haven't received user input yet).
// Kept outside the workspace writable so mutations don't trigger workspace re-serialisation.
const _newSessions = writable<Set<SessionId>>(new Set());

function createWorkspaceStore() {
  const initialWorkspace = loadFromCache() || createDefaultWorkspace();

  // Ensure activeTabId is valid
  if (!initialWorkspace.activeTabId && initialWorkspace.tabs.length > 0) {
    initialWorkspace.activeTabId = initialWorkspace.tabs[0].id;
  }

  const { subscribe, set, update } = writable<Workspace>(initialWorkspace);

  // Debounce timer for server save
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveCallback: ((workspace: Workspace) => Promise<void>) | null = null;

  /** Clone only the path from root to the target split, leaving the rest shared. */
  function cloneWithNewRatios(node: SplitNode, splitId: string, ratios: number[]): SplitNode {
    if (node.type === 'pane') return node;
    if (node.id === splitId) return { ...node, ratios: [...ratios] };
    let changed = false;
    const newChildren = node.children.map((child) => {
      const newChild = cloneWithNewRatios(child, splitId, ratios);
      if (newChild !== child) changed = true;
      return newChild;
    });
    return changed ? { ...node, children: newChildren } : node;
  }

  /**
   * Shallow-clone every node in the tree so Svelte 5's fine-grained prop
   * reactivity sees new object references after in-place mutations.
   */
  function shallowCloneTree(node: SplitNode): SplitNode {
    if (node.type === 'pane') return { ...node };
    return { ...node, children: node.children.map(shallowCloneTree) };
  }

  /**
   * Return a new ws where the active tab's entire tree has new object references.
   * Call this at the end of every update() that mutates the pane tree in-place,
   * so that SplitContainer/Pane props detect the change via === comparison.
   */
  function refreshActiveTab(ws: Workspace): Workspace {
    const tabIdx = ws.tabs.findIndex((t) => t.id === ws.activeTabId);
    if (tabIdx < 0) return ws;
    const tab = ws.tabs[tabIdx];
    const newTabs = [...ws.tabs];
    newTabs[tabIdx] = { ...tab, root: shallowCloneTree(tab.root) };
    return { ...ws, tabs: newTabs };
  }

  function scheduleSave(workspace: Workspace) {
    saveToCache(workspace);

    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(async () => {
      if (saveCallback) {
        try {
          await saveCallback(workspace);
        } catch (e) {
          console.error('[Workspace] Failed to save to server:', e);
        }
      }
      saveTimer = null;
    }, 1000);
  }

  return {
    subscribe,

    /**
     * Set the save callback for server persistence
     */
    setSaveCallback(callback: (workspace: Workspace) => Promise<void>) {
      saveCallback = callback;
    },

    /**
     * Initialize workspace from server or use cached/default
     */
    initialize(serverWorkspace: Workspace | null, initialSessionId?: SessionId) {
      if (serverWorkspace && serverWorkspace.tabs.length > 0) {
        if (!serverWorkspace.activeTabId) {
          serverWorkspace.activeTabId = serverWorkspace.tabs[0].id;
        }
        migrateWorkspace(serverWorkspace);
        set(serverWorkspace);
        saveToCache(serverWorkspace);
      } else if (initialSessionId) {
        const workspace = createDefaultWorkspace(initialSessionId);
        workspace.activeTabId = workspace.tabs[0].id;
        set(workspace);
        scheduleSave(workspace);
      }
    },

    /**
     * Get current workspace synchronously
     */
    get(): Workspace {
      return get({ subscribe });
    },

    // ==================== Tab Operations ====================

    /**
     * Create a new tab
     */
    createTab(name?: string, sessionId?: SessionId): TabId {
      let newTabId: TabId = '';
      update((ws) => {
        const tabNumber = ws.tabs.length + 1;
        const tab = createTab(name || `Terminal ${tabNumber}`, sessionId);
        newTabId = tab.id;
        ws.tabs.push(tab);
        ws.activeTabId = tab.id;
        scheduleSave(ws);
        return ws;
      });
      return newTabId;
    },

    /**
     * Close a tab
     */
    closeTab(tabId: TabId) {
      update((ws) => {
        const index = ws.tabs.findIndex((t) => t.id === tabId);
        if (index === -1) return ws;

        ws.tabs.splice(index, 1);

        // If we closed the active tab, activate another
        if (ws.activeTabId === tabId) {
          if (ws.tabs.length > 0) {
            const newIndex = Math.min(index, ws.tabs.length - 1);
            ws.activeTabId = ws.tabs[newIndex].id;
          } else {
            // Create a new default tab if all are closed
            const tab = createTab('Terminal 1');
            ws.tabs.push(tab);
            ws.activeTabId = tab.id;
          }
        }

        scheduleSave(ws);
        return ws;
      });
    },

    /**
     * Set the active tab
     */
    setActiveTab(tabId: TabId) {
      update((ws) => {
        if (ws.tabs.some((t) => t.id === tabId)) {
          ws.activeTabId = tabId;
          scheduleSave(ws);
        }
        return ws;
      });
    },

    /**
     * Rename a tab
     */
    renameTab(tabId: TabId, newName: string) {
      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === tabId);
        if (tab) {
          tab.name = newName;
          scheduleSave(ws);
        }
        return ws;
      });
    },

    /**
     * Reorder tabs
     */
    reorderTabs(fromIndex: number, toIndex: number) {
      update((ws) => {
        const [tab] = ws.tabs.splice(fromIndex, 1);
        ws.tabs.splice(toIndex, 0, tab);
        scheduleSave(ws);
        return ws;
      });
    },

    // ==================== Pane Operations ====================

    /**
     * Clear sessionIds from panes that reference sessions not in the given set.
     * Called when the session list is received to clean up stale references.
     */
    clearStaleSessions(validSessionIds: Set<SessionId>) {
      update((ws) => {
        let changed = false;
        for (const tab of ws.tabs) {
          for (const pane of getAllPanes(tab.root)) {
            if (pane.sessionId && !validSessionIds.has(pane.sessionId)) {
              pane.sessionId = null;
              changed = true;
            }
          }
          // Remove stale IDs from sessionOrder
          const before = tab.sessionOrder.length;
          tab.sessionOrder = tab.sessionOrder.filter((id) => validSessionIds.has(id));
          if (tab.sessionOrder.length !== before) changed = true;
        }
        if (!changed) return ws;
        scheduleSave(ws);
        return refreshActiveTab(ws);
      });
    },

    /**
     * Assign a session to a pane
     */
    assignSession(paneId: PaneId, sessionId: SessionId | null) {
      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return ws;

        const pane = findPane(tab.root, paneId);
        if (!pane) return ws;
        pane.sessionId = sessionId;
        // Add new sessions to sessionOrder if not already present
        if (sessionId && !tab.sessionOrder.includes(sessionId)) {
          tab.sessionOrder.push(sessionId);
        }
        scheduleSave(ws);
        return refreshActiveTab(ws);
      });
    },

    /**
     * Split a pane in the given direction
     */
    splitPane(
      paneId: PaneId,
      direction: SplitDirection,
      newSessionId?: SessionId
    ): PaneId | null {
      let newPaneId: PaneId | null = null;

      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return ws;

        // Find the pane and its parent
        const parentResult = findParent(tab.root, paneId);

        if (!parentResult) {
          // The pane is the root - replace root with a split
          if (tab.root.type === 'pane' && tab.root.id === paneId) {
            const newPane = createPane(newSessionId || null);
            newPaneId = newPane.id;
            tab.root = createSplit(direction, [tab.root, newPane]);
            if (newSessionId && !tab.sessionOrder.includes(newSessionId)) {
              tab.sessionOrder.push(newSessionId);
            }
            scheduleSave(ws);
            return refreshActiveTab(ws);
          }
          return ws;
        }

        const { parent, index } = parentResult;
        const targetPane = parent.children[index];

        if (targetPane.type !== 'pane') return ws;

        const newPane = createPane(newSessionId || null);
        newPaneId = newPane.id;

        if (parent.direction === direction) {
          // Same direction - add new pane next to existing
          parent.children.splice(index + 1, 0, newPane);
          // Recalculate ratios
          const count = parent.children.length;
          parent.ratios = parent.children.map(() => 1 / count);
        } else {
          // Different direction - wrap in new split
          const newSplit = createSplit(direction, [targetPane, newPane]);
          parent.children[index] = newSplit;
        }

        if (newSessionId && !tab.sessionOrder.includes(newSessionId)) {
          tab.sessionOrder.push(newSessionId);
        }
        scheduleSave(ws);
        return refreshActiveTab(ws);
      });

      return newPaneId;
    },

    /**
     * Split a pane, placing the new pane before the target
     */
    splitPaneBefore(
      paneId: PaneId,
      direction: SplitDirection,
      newSessionId?: SessionId
    ): PaneId | null {
      const newPaneId = this.splitPane(paneId, direction, newSessionId);
      if (!newPaneId) return null;

      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return ws;

        const parentResult = findParent(tab.root, newPaneId);
        if (parentResult && parentResult.index > 0) {
          const { parent, index } = parentResult;
          [parent.children[index - 1], parent.children[index]] =
            [parent.children[index], parent.children[index - 1]];
        }
        scheduleSave(ws);
        return refreshActiveTab(ws);
      });

      return newPaneId;
    },

    /**
     * Handle drop on a pane (from drag & drop)
     */
    handleDrop(
      targetPaneId: PaneId,
      sessionId: SessionId,
      dropZone: DropZone
    ): PaneId | null {
      if (dropZone === 'center') {
        this.assignSession(targetPaneId, sessionId);
        return targetPaneId;
      }

      const directionMap: Record<DropZone, SplitDirection | null> = {
        center: null,
        left: 'horizontal',
        right: 'horizontal',
        top: 'vertical',
        bottom: 'vertical',
      };

      const direction = directionMap[dropZone];
      if (!direction) return null;

      if (dropZone === 'left' || dropZone === 'top') {
        return this.splitPaneBefore(targetPaneId, direction, sessionId);
      }

      return this.splitPane(targetPaneId, direction, sessionId);
    },

    /**
     * Move a pane to another pane's position (swap on center, split on edge)
     */
    movePane(
      sourcePaneId: PaneId,
      targetPaneId: PaneId,
      dropZone: DropZone
    ) {
      if (sourcePaneId === targetPaneId) return;

      if (dropZone === 'center') {
        // Swap sessions between source and target panes
        update((ws) => {
          const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
          if (!tab) return ws;

          const sourcePane = findPane(tab.root, sourcePaneId);
          const targetPane = findPane(tab.root, targetPaneId);
          if (!sourcePane || !targetPane) return ws;

          const tmp = sourcePane.sessionId;
          sourcePane.sessionId = targetPane.sessionId;
          targetPane.sessionId = tmp;
          scheduleSave(ws);
          return refreshActiveTab(ws);
        });
      } else {
        // Edge drop: move source session to a new split at target, then close source
        const ws = get({ subscribe });
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return;

        const sourcePane = findPane(tab.root, sourcePaneId);
        if (!sourcePane?.sessionId) return;

        const sourceSessionId = sourcePane.sessionId;
        this.handleDrop(targetPaneId, sourceSessionId, dropZone);
        this.closePane(sourcePaneId);
      }
    },

    /**
     * Detach a pane (close/clear it, leaving session in sidebar list)
     */
    detachPane(paneId: PaneId) {
      this.closePane(paneId);
    },

    /**
     * Close a pane
     */
    closePane(paneId: PaneId) {
      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return ws;

        // If root is the pane, clear its session but keep the pane
        if (tab.root.type === 'pane' && tab.root.id === paneId) {
          tab.root.sessionId = null;
          scheduleSave(ws);
          return refreshActiveTab(ws);
        }

        const parentResult = findParent(tab.root, paneId);
        if (!parentResult) return ws;

        const { parent, index } = parentResult;

        // Remove the pane
        parent.children.splice(index, 1);
        parent.ratios.splice(index, 1);

        // Renormalize ratios
        const sum = parent.ratios.reduce((a, b) => a + b, 0);
        parent.ratios = parent.ratios.map((r) => r / sum);

        // If only one child left, promote it
        if (parent.children.length === 1) {
          const grandparentResult = findParent(tab.root, parent.id);
          if (grandparentResult) {
            grandparentResult.parent.children[grandparentResult.index] =
              parent.children[0];
          } else if (tab.root === parent) {
            // Parent is root
            tab.root = parent.children[0];
          }
        }

        scheduleSave(ws);
        return refreshActiveTab(ws);
      });
    },

    /**
     * Update split ratios (immutable — clones the path to the changed split
     * so Svelte 5's fine-grained reactivity sees new object references).
     */
    updateRatios(splitId: string, ratios: number[]) {
      update((ws) => {
        const tabIdx = ws.tabs.findIndex((t) => t.id === ws.activeTabId);
        if (tabIdx < 0) return ws;
        const tab = ws.tabs[tabIdx];
        const newRoot = cloneWithNewRatios(tab.root, splitId, ratios);
        if (newRoot === tab.root) return ws; // splitId not found
        const newTab = { ...tab, root: newRoot };
        const newTabs = [...ws.tabs];
        newTabs[tabIdx] = newTab;
        const newWs = { ...ws, tabs: newTabs };
        scheduleSave(newWs);
        return newWs;
      });
    },

    // ==================== Session Ordering ====================

    /**
     * Reorder a session within a tab's sessionOrder list.
     */
    reorderSession(tabId: TabId, fromIndex: number, toIndex: number) {
      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === tabId);
        if (!tab || fromIndex === toIndex) return ws;
        const [moved] = tab.sessionOrder.splice(fromIndex, 1);
        tab.sessionOrder.splice(toIndex, 0, moved);
        scheduleSave(ws);
        return ws;
      });
    },

    /**
     * Move a session from one tab's sessionOrder to another tab's sessionOrder.
     */
    moveSessionToTab(sessionId: SessionId, fromTabId: TabId, toTabId: TabId) {
      update((ws) => {
        const fromTab = ws.tabs.find((t) => t.id === fromTabId);
        const toTab = ws.tabs.find((t) => t.id === toTabId);
        if (!fromTab || !toTab) return ws;
        fromTab.sessionOrder = fromTab.sessionOrder.filter((id) => id !== sessionId);
        if (!toTab.sessionOrder.includes(sessionId)) {
          toTab.sessionOrder.push(sessionId);
        }
        scheduleSave(ws);
        return ws;
      });
    },

    // ==================== Layout Templates ====================

    /**
     * Save current tab layout as a template
     */
    saveAsTemplate(name: string): LayoutTemplate {
      const ws = get({ subscribe });
      const tab = ws.tabs.find((t) => t.id === ws.activeTabId);

      // Clone the structure without session assignments
      function cloneWithoutSessions(node: SplitNode): SplitNode {
        if (node.type === 'pane') {
          return createPane(null);
        }
        return {
          ...node,
          id: crypto.randomUUID(),
          children: node.children.map(cloneWithoutSessions),
        };
      }

      const template: LayoutTemplate = {
        id: crypto.randomUUID(),
        name,
        root: tab ? cloneWithoutSessions(tab.root) : createPane(null),
        createdAt: new Date().toISOString(),
      };

      return template;
    },

    // ==================== New Session Flags ====================

    /**
     * Mark a session as new (badge shown until first input).
     */
    markSessionNew(sessionId: SessionId) {
      _newSessions.update((s) => new Set([...s, sessionId]));
    },

    /**
     * Clear the new flag (call on first user input).
     */
    clearSessionNew(sessionId: SessionId) {
      _newSessions.update((s) => {
        const next = new Set(s);
        next.delete(sessionId);
        return next;
      });
    },

    /**
     * Returns true if the session has the "new" flag set.
     * Note: this is NOT reactive when called outside a Svelte reactive context.
     * Use the exported `newSessionIds` store for reactive template bindings.
     */
    isSessionNew(sessionId: SessionId): boolean {
      return get(_newSessions).has(sessionId);
    },

    /**
     * Apply a layout template to the current tab
     */
    applyTemplate(template: LayoutTemplate) {
      update((ws) => {
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return ws;

        // Clone the template structure (generate new IDs)
        function cloneStructure(node: SplitNode): SplitNode {
          if (node.type === 'pane') {
            return createPane(null);
          }
          return {
            ...node,
            id: crypto.randomUUID(),
            children: node.children.map(cloneStructure),
          };
        }

        tab.root = cloneStructure(template.root);
        scheduleSave(ws);
        return ws;
      });
    },
  };
}

/**
 * The global workspace store
 */
export const workspaceStore = createWorkspaceStore();

/**
 * Derived store for the active tab
 */
export const activeTab = derived(workspaceStore, ($ws) =>
  $ws.tabs.find((t) => t.id === $ws.activeTabId)
);

/**
 * Derived store for all panes in the active tab
 */
export const activePanes = derived(activeTab, ($tab) =>
  $tab ? getAllPanes($tab.root) : []
);

/**
 * Read-only store of session IDs currently flagged as "new".
 * Use this in Svelte templates for reactive badge rendering:
 *   {#if $newSessionIds.has(session.id)} ... {/if}
 */
export const newSessionIds = readonly(_newSessions);

/**
 * Derived store: how many panes each session is assigned to (across all tabs)
 */
export const sessionPaneCounts = derived(workspaceStore, ($ws) => {
  const counts = new Map<SessionId, number>();
  for (const tab of $ws.tabs) {
    for (const pane of getAllPanes(tab.root)) {
      if (pane.sessionId) {
        counts.set(pane.sessionId, (counts.get(pane.sessionId) || 0) + 1);
      }
    }
  }
  return counts;
});
