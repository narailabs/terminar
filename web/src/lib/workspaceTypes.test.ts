import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPane,
  createSplit,
  createTab,
  createDefaultWorkspace,
  findPane,
  findParent,
  getAllPanes,
  getWorkspaceSessionIds,
  type Pane,
  type SplitContainer,
  type Workspace,
} from './workspaceTypes';

let uuidCounter = 0;

beforeEach(() => {
  uuidCounter = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `uuid-${++uuidCounter}`,
  });
});

describe('createPane', () => {
  it('creates a pane with null sessionId by default', () => {
    const pane = createPane();
    expect(pane).toEqual({
      type: 'pane',
      id: 'uuid-1',
      sessionId: null,
    });
  });

  it('creates a pane with the given sessionId', () => {
    const pane = createPane('session-abc');
    expect(pane).toEqual({
      type: 'pane',
      id: 'uuid-1',
      sessionId: 'session-abc',
    });
  });
});

describe('createSplit', () => {
  it('creates a horizontal split with default equal ratios', () => {
    const p1 = createPane();
    const p2 = createPane();
    const split = createSplit('horizontal', [p1, p2]);

    expect(split.type).toBe('split');
    expect(split.id).toBe('uuid-3');
    expect(split.direction).toBe('horizontal');
    expect(split.children).toEqual([p1, p2]);
    expect(split.ratios).toEqual([0.5, 0.5]);
  });

  it('creates a vertical split with custom ratios', () => {
    const p1 = createPane();
    const p2 = createPane();
    const split = createSplit('vertical', [p1, p2], [0.3, 0.7]);

    expect(split.direction).toBe('vertical');
    expect(split.ratios).toEqual([0.3, 0.7]);
  });

  it('computes default ratios for three children', () => {
    const p1 = createPane();
    const p2 = createPane();
    const p3 = createPane();
    const split = createSplit('horizontal', [p1, p2, p3]);

    expect(split.ratios.length).toBe(3);
    for (const r of split.ratios) {
      expect(r).toBeCloseTo(1 / 3);
    }
  });
});

describe('createTab', () => {
  it('creates a tab with the given name and a root pane', () => {
    const tab = createTab('My Tab');

    expect(tab.id).toBe('uuid-1');
    expect(tab.name).toBe('My Tab');
    expect(tab.root.type).toBe('pane');
    expect((tab.root as Pane).sessionId).toBeNull();
  });

  it('creates a tab with an initial sessionId on the root pane', () => {
    const tab = createTab('Tab 1', 'session-xyz');

    expect(tab.name).toBe('Tab 1');
    expect((tab.root as Pane).sessionId).toBe('session-xyz');
  });
});

describe('createDefaultWorkspace', () => {
  it('creates a workspace with one tab and an empty activeTabId', () => {
    const ws = createDefaultWorkspace();

    expect(ws.tabs.length).toBe(1);
    expect(ws.tabs[0].name).toBe('Main');
    expect(ws.activeTabId).toBe('');
    expect(ws.tabs[0].root.type).toBe('pane');
    expect((ws.tabs[0].root as Pane).sessionId).toBeNull();
  });

  it('passes the initial sessionId to the root pane', () => {
    const ws = createDefaultWorkspace('sess-1');

    expect((ws.tabs[0].root as Pane).sessionId).toBe('sess-1');
  });
});

describe('findPane', () => {
  it('returns the pane when searching a matching flat pane', () => {
    const pane: Pane = { type: 'pane', id: 'p1', sessionId: null };
    expect(findPane(pane, 'p1')).toBe(pane);
  });

  it('returns null when the flat pane does not match', () => {
    const pane: Pane = { type: 'pane', id: 'p1', sessionId: null };
    expect(findPane(pane, 'p2')).toBeNull();
  });

  it('finds a pane nested inside a split', () => {
    const target: Pane = { type: 'pane', id: 'deep', sessionId: 'sess-1' };
    const inner: SplitContainer = {
      type: 'split',
      id: 's2',
      direction: 'vertical',
      children: [
        { type: 'pane', id: 'other', sessionId: null },
        target,
      ],
      ratios: [0.5, 0.5],
    };
    const root: SplitContainer = {
      type: 'split',
      id: 's1',
      direction: 'horizontal',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        inner,
      ],
      ratios: [0.5, 0.5],
    };

    const found = findPane(root, 'deep');
    expect(found).toBe(target);
  });
});

describe('findParent', () => {
  it('returns null when root is a pane (no parent possible)', () => {
    const pane: Pane = { type: 'pane', id: 'p1', sessionId: null };
    expect(findParent(pane, 'p1')).toBeNull();
  });

  it('finds the parent and index of a direct child', () => {
    const child: Pane = { type: 'pane', id: 'p2', sessionId: null };
    const root: SplitContainer = {
      type: 'split',
      id: 's1',
      direction: 'horizontal',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        child,
      ],
      ratios: [0.5, 0.5],
    };

    const result = findParent(root, 'p2');
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(root);
    expect(result!.index).toBe(1);
  });

  it('finds the parent of a deeply nested node', () => {
    const target: Pane = { type: 'pane', id: 'deep', sessionId: null };
    const innerSplit: SplitContainer = {
      type: 'split',
      id: 's2',
      direction: 'vertical',
      children: [target, { type: 'pane', id: 'p3', sessionId: null }],
      ratios: [0.5, 0.5],
    };
    const root: SplitContainer = {
      type: 'split',
      id: 's1',
      direction: 'horizontal',
      children: [
        { type: 'pane', id: 'p1', sessionId: null },
        innerSplit,
      ],
      ratios: [0.5, 0.5],
    };

    const result = findParent(root, 'deep');
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(innerSplit);
    expect(result!.index).toBe(0);
  });
});

describe('getAllPanes', () => {
  it('returns a single-element array for a lone pane', () => {
    const pane: Pane = { type: 'pane', id: 'p1', sessionId: 'sess-1' };
    expect(getAllPanes(pane)).toEqual([pane]);
  });

  it('collects all panes from a nested split tree', () => {
    const p1: Pane = { type: 'pane', id: 'p1', sessionId: null };
    const p2: Pane = { type: 'pane', id: 'p2', sessionId: 'sess-a' };
    const p3: Pane = { type: 'pane', id: 'p3', sessionId: 'sess-b' };
    const root: SplitContainer = {
      type: 'split',
      id: 's1',
      direction: 'horizontal',
      children: [
        p1,
        {
          type: 'split',
          id: 's2',
          direction: 'vertical',
          children: [p2, p3],
          ratios: [0.5, 0.5],
        },
      ],
      ratios: [0.5, 0.5],
    };

    const panes = getAllPanes(root);
    expect(panes).toEqual([p1, p2, p3]);
  });
});

describe('getWorkspaceSessionIds', () => {
  it('returns an empty array when no panes have sessions', () => {
    const ws: Workspace = {
      tabs: [
        {
          id: 't1',
          name: 'Tab 1',
          root: { type: 'pane', id: 'p1', sessionId: null },
        },
      ],
      activeTabId: 't1',
    };

    expect(getWorkspaceSessionIds(ws)).toEqual([]);
  });

  it('collects session ids from multiple tabs', () => {
    const ws: Workspace = {
      tabs: [
        {
          id: 't1',
          name: 'Tab 1',
          root: { type: 'pane', id: 'p1', sessionId: 'sess-1' },
        },
        {
          id: 't2',
          name: 'Tab 2',
          root: { type: 'pane', id: 'p2', sessionId: 'sess-2' },
        },
      ],
      activeTabId: 't1',
    };

    const ids = getWorkspaceSessionIds(ws);
    expect(ids).toContain('sess-1');
    expect(ids).toContain('sess-2');
    expect(ids.length).toBe(2);
  });

  it('deduplicates session ids appearing in multiple panes', () => {
    const ws: Workspace = {
      tabs: [
        {
          id: 't1',
          name: 'Tab 1',
          root: {
            type: 'split',
            id: 's1',
            direction: 'horizontal',
            children: [
              { type: 'pane', id: 'p1', sessionId: 'sess-shared' },
              { type: 'pane', id: 'p2', sessionId: 'sess-shared' },
            ],
            ratios: [0.5, 0.5],
          },
        },
        {
          id: 't2',
          name: 'Tab 2',
          root: { type: 'pane', id: 'p3', sessionId: 'sess-shared' },
        },
      ],
      activeTabId: 't1',
    };

    const ids = getWorkspaceSessionIds(ws);
    expect(ids).toEqual(['sess-shared']);
  });
});
