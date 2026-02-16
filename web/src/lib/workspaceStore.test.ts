import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Workspace, Tab, Pane, SplitContainer, SplitNode } from './workspaceTypes';
import { getAllPanes, findPane, findParent } from './workspaceTypes';

// ── Mocks: must be set up BEFORE importing the store singleton ──────────────

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

const localStorageStore: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
  }),
});

// Now import the store (singleton will initialise using our mocked globals)
const { workspaceStore, activeTab, activePanes } = await import('./workspaceStore');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal fresh workspace for resetting between tests */
function freshWorkspace(sessionId?: string): Workspace {
  uuidCounter = 0; // reset so IDs are predictable
  const pane: Pane = { type: 'pane', id: `uuid-${++uuidCounter}`, sessionId: sessionId ?? null };
  const tab: Tab = { id: `uuid-${++uuidCounter}`, name: 'Terminal 1', root: pane };
  return { tabs: [tab], activeTabId: tab.id };
}

function getStore(): Workspace {
  return workspaceStore.get();
}

function activeTabFromStore(): Tab | undefined {
  return getStore().tabs.find((t) => t.id === getStore().activeTabId);
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('workspaceStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    uuidCounter = 100; // high offset so freshWorkspace IDs don't collide with store-generated ones
    const ws = freshWorkspace();
    workspaceStore.initialize(ws);
    (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ────────────────────── Initialization ──────────────────────

  describe('initialize', () => {
    it('should accept server workspace and use it', () => {
      const pane: Pane = { type: 'pane', id: 'srv-pane', sessionId: 'srv-session' };
      const tab: Tab = { id: 'srv-tab', name: 'Server Tab', root: pane };
      const serverWs: Workspace = { tabs: [tab], activeTabId: 'srv-tab' };

      workspaceStore.initialize(serverWs);
      const ws = getStore();
      expect(ws.tabs).toHaveLength(1);
      expect(ws.tabs[0].name).toBe('Server Tab');
      expect(ws.activeTabId).toBe('srv-tab');
    });

    it('should set activeTabId to first tab if server workspace has none', () => {
      const pane: Pane = { type: 'pane', id: 'p1', sessionId: null };
      const tab: Tab = { id: 't1', name: 'Tab', root: pane };
      const serverWs: Workspace = { tabs: [tab], activeTabId: '' };

      workspaceStore.initialize(serverWs);
      expect(getStore().activeTabId).toBe('t1');
    });

    it('should create default workspace with initialSessionId when no server data', () => {
      workspaceStore.initialize(null, 'init-session');
      const ws = getStore();
      expect(ws.tabs).toHaveLength(1);
      const panes = getAllPanes(ws.tabs[0].root);
      expect(panes[0].sessionId).toBe('init-session');
    });

    it('should do nothing when server workspace is null and no initialSessionId', () => {
      // First set known state
      const pane: Pane = { type: 'pane', id: 'keep', sessionId: null };
      const tab: Tab = { id: 'keep-tab', name: 'Keep', root: pane };
      workspaceStore.initialize({ tabs: [tab], activeTabId: 'keep-tab' });

      // Now call with nothing
      workspaceStore.initialize(null);
      expect(getStore().activeTabId).toBe('keep-tab');
    });
  });

  // ────────────────────── Tab Operations ──────────────────────

  describe('createTab', () => {
    it('should add a new tab and make it active', () => {
      const tabId = workspaceStore.createTab('My Tab');
      const ws = getStore();
      expect(ws.tabs).toHaveLength(2);
      expect(ws.activeTabId).toBe(tabId);
      expect(ws.tabs[1].name).toBe('My Tab');
    });

    it('should auto-name tabs based on count', () => {
      workspaceStore.createTab();
      const ws = getStore();
      expect(ws.tabs[1].name).toBe('Terminal 2');
    });

    it('should create tab with a session assigned to its root pane', () => {
      workspaceStore.createTab('With Session', 'session-abc');
      const ws = getStore();
      const newTab = ws.tabs[1];
      expect(newTab.root.type).toBe('pane');
      expect((newTab.root as Pane).sessionId).toBe('session-abc');
    });

    it('should return the new tab id', () => {
      const tabId = workspaceStore.createTab('Test');
      expect(typeof tabId).toBe('string');
      expect(tabId.length).toBeGreaterThan(0);
    });
  });

  describe('closeTab', () => {
    it('should remove the specified tab', () => {
      workspaceStore.createTab('Second');
      const ws = getStore();
      const firstTabId = ws.tabs[0].id;
      workspaceStore.closeTab(ws.tabs[1].id);
      expect(getStore().tabs).toHaveLength(1);
      expect(getStore().tabs[0].id).toBe(firstTabId);
    });

    it('should switch active tab when closing the active one (pick previous)', () => {
      const secondId = workspaceStore.createTab('Second');
      workspaceStore.createTab('Third');
      // Active is now Third. Close Third, should fall to Second.
      workspaceStore.closeTab(getStore().activeTabId);
      expect(getStore().activeTabId).toBe(secondId);
    });

    it('should create a new default tab when closing the last tab', () => {
      const ws = getStore();
      const onlyTabId = ws.tabs[0].id;
      workspaceStore.closeTab(onlyTabId);
      const after = getStore();
      expect(after.tabs).toHaveLength(1);
      expect(after.tabs[0].name).toBe('Terminal 1');
      expect(after.activeTabId).toBe(after.tabs[0].id);
    });

    it('should keep active tab unchanged when closing a non-active tab', () => {
      const secondId = workspaceStore.createTab('Second');
      // secondId is now active
      const firstId = getStore().tabs[0].id;
      workspaceStore.closeTab(firstId);
      expect(getStore().activeTabId).toBe(secondId);
    });

    it('should do nothing if tabId is not found', () => {
      const before = getStore().tabs.length;
      workspaceStore.closeTab('nonexistent');
      expect(getStore().tabs.length).toBe(before);
    });
  });

  describe('setActiveTab', () => {
    it('should change the active tab', () => {
      const firstId = getStore().tabs[0].id;
      workspaceStore.createTab('Second');
      workspaceStore.setActiveTab(firstId);
      expect(getStore().activeTabId).toBe(firstId);
    });

    it('should ignore invalid tabId', () => {
      const before = getStore().activeTabId;
      workspaceStore.setActiveTab('does-not-exist');
      expect(getStore().activeTabId).toBe(before);
    });
  });

  describe('renameTab', () => {
    it('should rename the specified tab', () => {
      const tabId = getStore().tabs[0].id;
      workspaceStore.renameTab(tabId, 'Renamed');
      expect(getStore().tabs[0].name).toBe('Renamed');
    });

    it('should do nothing for unknown tab', () => {
      workspaceStore.renameTab('nope', 'Wont Work');
      expect(getStore().tabs[0].name).toBe('Terminal 1');
    });
  });

  describe('reorderTabs', () => {
    it('should move a tab from one index to another', () => {
      workspaceStore.createTab('Second');
      workspaceStore.createTab('Third');

      const ws = getStore();
      const names = ws.tabs.map((t) => t.name);
      expect(names).toEqual(['Terminal 1', 'Second', 'Third']);

      workspaceStore.reorderTabs(0, 2);
      const reordered = getStore().tabs.map((t) => t.name);
      expect(reordered).toEqual(['Second', 'Third', 'Terminal 1']);
    });
  });

  // ────────────────────── Pane Operations ──────────────────────

  describe('assignSession', () => {
    it('should assign a session to the root pane', () => {
      const ws = getStore();
      const paneId = (ws.tabs[0].root as Pane).id;
      workspaceStore.assignSession(paneId, 'session-1');
      const pane = getStore().tabs[0].root as Pane;
      expect(pane.sessionId).toBe('session-1');
    });

    it('should clear a session when passed null', () => {
      const ws = getStore();
      const paneId = (ws.tabs[0].root as Pane).id;
      workspaceStore.assignSession(paneId, 'session-1');
      workspaceStore.assignSession(paneId, null);
      expect((getStore().tabs[0].root as Pane).sessionId).toBeNull();
    });
  });

  describe('splitPane', () => {
    it('should split the root pane horizontally', () => {
      const paneId = (getStore().tabs[0].root as Pane).id;
      const newPaneId = workspaceStore.splitPane(paneId, 'horizontal');
      expect(newPaneId).toBeTruthy();

      const root = activeTabFromStore()!.root;
      expect(root.type).toBe('split');
      const split = root as SplitContainer;
      expect(split.direction).toBe('horizontal');
      expect(split.children).toHaveLength(2);
      expect(split.ratios).toEqual([0.5, 0.5]);
    });

    it('should split the root pane vertically', () => {
      const paneId = (getStore().tabs[0].root as Pane).id;
      workspaceStore.splitPane(paneId, 'vertical');

      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.direction).toBe('vertical');
    });

    it('should add a sibling when splitting in the same direction as parent', () => {
      // Split root pane horizontally first
      const paneId = (getStore().tabs[0].root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal');

      // Split the original pane again in the same direction
      workspaceStore.splitPane(paneId, 'horizontal');
      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.children).toHaveLength(3);
      expect(root.ratios.length).toBe(3);
      // All ratios should be roughly 1/3
      root.ratios.forEach((r) => expect(r).toBeCloseTo(1 / 3, 5));
    });

    it('should nest a split when splitting in a different direction from parent', () => {
      const paneId = (getStore().tabs[0].root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal');

      // Now split original pane vertically (different direction from parent horizontal)
      workspaceStore.splitPane(paneId, 'vertical');
      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.direction).toBe('horizontal');
      expect(root.children).toHaveLength(2);
      // First child should now be a nested split
      const nestedSplit = root.children[0] as SplitContainer;
      expect(nestedSplit.type).toBe('split');
      expect(nestedSplit.direction).toBe('vertical');
      expect(nestedSplit.children).toHaveLength(2);
    });

    it('should assign a session to the new pane', () => {
      const paneId = (getStore().tabs[0].root as Pane).id;
      const newPaneId = workspaceStore.splitPane(paneId, 'horizontal', 'new-session');
      const root = activeTabFromStore()!.root as SplitContainer;
      const newPane = findPane(root, newPaneId!);
      expect(newPane).not.toBeNull();
      expect(newPane!.sessionId).toBe('new-session');
    });

    it('should return null when the active tab does not exist', () => {
      // Force a state where activeTabId points nowhere
      workspaceStore.initialize({
        tabs: [{ id: 't', name: 'T', root: { type: 'pane', id: 'p', sessionId: null } }],
        activeTabId: 'nonexistent',
      });
      const result = workspaceStore.splitPane('p', 'horizontal');
      expect(result).toBeNull();
    });
  });

  describe('closePane', () => {
    it('should clear session on the root pane (cannot remove last pane)', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.assignSession(paneId, 'some-session');
      workspaceStore.closePane(paneId);
      expect((activeTabFromStore()!.root as Pane).sessionId).toBeNull();
    });

    it('should remove a child pane from a split', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const newPaneId = workspaceStore.splitPane(paneId, 'horizontal')!;

      workspaceStore.closePane(newPaneId);
      // Should collapse back to a single pane (promote the remaining child)
      expect(activeTabFromStore()!.root.type).toBe('pane');
      expect(activeTabFromStore()!.root.id).toBe(paneId);
    });

    it('should promote the sole remaining child when split has one child left', () => {
      const originalPaneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(originalPaneId, 'horizontal');
      const root = activeTabFromStore()!.root as SplitContainer;
      const secondPaneId = root.children[1].id;

      workspaceStore.closePane(originalPaneId);
      // The remaining child should become the new root
      expect(activeTabFromStore()!.root.type).toBe('pane');
      expect(activeTabFromStore()!.root.id).toBe(secondPaneId);
    });

    it('should re-normalize ratios after removing a child from a 3-way split', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal');
      // Split same direction to get 3 children
      workspaceStore.splitPane(paneId, 'horizontal');

      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.children).toHaveLength(3);
      const middleId = root.children[1].id;

      workspaceStore.closePane(middleId);
      const after = activeTabFromStore()!.root as SplitContainer;
      expect(after.children).toHaveLength(2);
      const sum = after.ratios.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });
  });

  describe('handleDrop', () => {
    it('should assign session on center drop', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const result = workspaceStore.handleDrop(paneId, 'drop-session', 'center');
      expect(result).toBe(paneId);
      expect((activeTabFromStore()!.root as Pane).sessionId).toBe('drop-session');
    });

    it('should split right on right drop', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const newPaneId = workspaceStore.handleDrop(paneId, 'right-session', 'right');
      expect(newPaneId).toBeTruthy();

      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.direction).toBe('horizontal');
      // Original pane should be first, new pane second (right)
      expect(root.children[0].id).toBe(paneId);
      expect(root.children[1].id).toBe(newPaneId);
      expect((root.children[1] as Pane).sessionId).toBe('right-session');
    });

    it('should split left and swap order on left drop', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const newPaneId = workspaceStore.handleDrop(paneId, 'left-session', 'left');
      expect(newPaneId).toBeTruthy();

      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.direction).toBe('horizontal');
      // New pane should be swapped to the left (first position)
      expect(root.children[0].id).toBe(newPaneId);
      expect((root.children[0] as Pane).sessionId).toBe('left-session');
      expect(root.children[1].id).toBe(paneId);
    });

    it('should split bottom on bottom drop', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const newPaneId = workspaceStore.handleDrop(paneId, 'bottom-session', 'bottom');
      expect(newPaneId).toBeTruthy();

      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.direction).toBe('vertical');
      expect(root.children[0].id).toBe(paneId);
      expect(root.children[1].id).toBe(newPaneId);
    });

    it('should split top and swap order on top drop', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const newPaneId = workspaceStore.handleDrop(paneId, 'top-session', 'top');
      expect(newPaneId).toBeTruthy();

      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.direction).toBe('vertical');
      expect(root.children[0].id).toBe(newPaneId);
      expect((root.children[0] as Pane).sessionId).toBe('top-session');
    });
  });

  // ────────────────────── Layout Templates ──────────────────────

  describe('saveAsTemplate', () => {
    it('should create a template from the current active tab', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.assignSession(paneId, 'sess-1');

      const template = workspaceStore.saveAsTemplate('My Template');
      expect(template.name).toBe('My Template');
      expect(template.createdAt).toBeTruthy();
      expect(template.id).toBeTruthy();
      // Template panes should have null sessions
      const panes = getAllPanes(template.root);
      panes.forEach((p) => expect(p.sessionId).toBeNull());
    });

    it('should preserve split structure in template', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal', 'sess-a');

      const template = workspaceStore.saveAsTemplate('Split Layout');
      expect(template.root.type).toBe('split');
      const split = template.root as SplitContainer;
      expect(split.children).toHaveLength(2);
      split.children.forEach((c) => {
        expect(c.type).toBe('pane');
        expect((c as Pane).sessionId).toBeNull();
      });
    });

    it('should generate new IDs for panes in template (not reuse originals)', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const template = workspaceStore.saveAsTemplate('ID Test');
      const templatePanes = getAllPanes(template.root);
      expect(templatePanes[0].id).not.toBe(paneId);
    });
  });

  describe('applyTemplate', () => {
    it('should replace active tab root with template structure', () => {
      // Create a template with 2 panes
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(paneId, 'vertical');
      const template = workspaceStore.saveAsTemplate('2-Pane');

      // Now create a new tab and apply the template
      workspaceStore.createTab('Apply Target');
      workspaceStore.applyTemplate(template);

      const root = activeTabFromStore()!.root;
      expect(root.type).toBe('split');
      const panes = getAllPanes(root);
      expect(panes).toHaveLength(2);
      // All sessions should be null in applied template
      panes.forEach((p) => expect(p.sessionId).toBeNull());
    });

    it('should generate fresh IDs on each apply', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      const template = workspaceStore.saveAsTemplate('Reuse');

      workspaceStore.applyTemplate(template);
      const firstApplyPanes = getAllPanes(activeTabFromStore()!.root);

      workspaceStore.applyTemplate(template);
      const secondApplyPanes = getAllPanes(activeTabFromStore()!.root);

      expect(firstApplyPanes[0].id).not.toBe(secondApplyPanes[0].id);
    });
  });

  // ────────────────────── updateRatios ──────────────────────

  describe('updateRatios', () => {
    it('should update ratios for a given split', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal');
      const splitId = (activeTabFromStore()!.root as SplitContainer).id;

      workspaceStore.updateRatios(splitId, [0.3, 0.7]);
      const root = activeTabFromStore()!.root as SplitContainer;
      expect(root.ratios).toEqual([0.3, 0.7]);
    });

    it('should do nothing for an unknown split id', () => {
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal');
      const root = activeTabFromStore()!.root as SplitContainer;
      const originalRatios = [...root.ratios];

      workspaceStore.updateRatios('unknown-split', [0.1, 0.9]);
      const after = activeTabFromStore()!.root as SplitContainer;
      expect(after.ratios).toEqual(originalRatios);
    });
  });

  // ────────────────────── Persistence ──────────────────────

  describe('persistence', () => {
    it('should call localStorage.setItem on tab creation', () => {
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
      workspaceStore.createTab('Persist Test');
      expect(localStorage.setItem).toHaveBeenCalled();
      const args = (localStorage.setItem as ReturnType<typeof vi.fn>).mock.calls;
      const wsArg = args.find((a: string[]) => a[0] === 'workspace-state');
      expect(wsArg).toBeTruthy();
    });

    it('should call localStorage.setItem on pane split', () => {
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
      const paneId = (activeTabFromStore()!.root as Pane).id;
      workspaceStore.splitPane(paneId, 'horizontal');
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('should call localStorage.setItem on closeTab', () => {
      workspaceStore.createTab('Second');
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
      workspaceStore.closeTab(getStore().tabs[0].id);
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('should call localStorage.setItem on renameTab', () => {
      (localStorage.setItem as ReturnType<typeof vi.fn>).mockClear();
      workspaceStore.renameTab(getStore().tabs[0].id, 'New Name');
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('should debounce server save callback', async () => {
      const saveCallback = vi.fn().mockResolvedValue(undefined);
      workspaceStore.setSaveCallback(saveCallback);

      workspaceStore.createTab('A');
      workspaceStore.createTab('B');

      // Before timer fires, callback should not have been called
      expect(saveCallback).not.toHaveBeenCalled();

      // Advance past the debounce timer (1000ms)
      await vi.advanceTimersByTimeAsync(1100);
      // The debounced callback should have fired (possibly once for the last mutation)
      expect(saveCallback).toHaveBeenCalled();

      // Clean up
      workspaceStore.setSaveCallback(null as any);
    });
  });

  // ────────────────────── Derived stores ──────────────────────

  describe('derived stores', () => {
    it('activeTab should reflect the current active tab', () => {
      let current: Tab | undefined;
      const unsub = activeTab.subscribe((v) => { current = v; });
      expect(current).toBeDefined();
      expect(current!.id).toBe(getStore().activeTabId);

      workspaceStore.createTab('New');
      expect(current!.name).toBe('New');
      unsub();
    });

    it('activePanes should list all panes in the active tab', () => {
      let panes: Pane[] = [];
      const unsub = activePanes.subscribe((v) => { panes = v; });
      expect(panes).toHaveLength(1);

      const paneId = panes[0].id;
      workspaceStore.splitPane(paneId, 'horizontal');
      expect(panes).toHaveLength(2);
      unsub();
    });
  });
});
