# UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 8 UX improvements: multi-window Electron support, sidebar reordering, lock screen recovery, image display, broadcast default-to-all, default tab name, split CWD inheritance, and "(new)" badge.

**Architecture:** Trivial fixes first (tasks 1-5), then medium features (tasks 6-8), then multi-window (task 9). Each task produces a working commit. All web features use existing Svelte 5 reactive patterns and HTML5 drag-drop. Multi-window uses Electron IPC with a new coordinator module.

**Tech Stack:** Svelte 5, xterm.js 6, Vitest, Electron, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-21-ux-improvements-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `web/src/lib/workspaceTypes.ts` | Modify | Add `sessionOrder: string[]` to Tab type |
| `web/src/lib/workspaceStore.ts` | Modify | Default tab name, splitPane CWD, reorder/move methods, isNew tracking |
| `web/src/lib/broadcastStore.svelte.ts` | Modify | Default-to-all when no targets |
| `web/src/lib/sessionCwdStore.svelte.ts` | Create | `sessionCwdMap` for tracking per-session CWD |
| `web/src/components/Terminal.svelte` | Modify | Image addon, enhance visibilitychange, isNew clearing |
| `web/src/components/TerminalList.svelte` | Modify | Drag-drop reorder, click-assigns-to-focused-pane, "(new)" badge |
| `web/src/components/Pane.svelte` | Modify | Accept sidebar session drops |
| `web/src/components/TabBar.svelte` | No change | Tab reorder already implemented |
| `web/src/App.svelte` | Modify | Wire sessionCwdStore to cwdChanged events |
| `web/package.json` | Modify | Add @xterm/addon-image |
| `tray/src/main/MultiWindowCoordinator.ts` | Create | Tab-to-window mapping, IPC hub |
| `tray/src/main/WindowManager.ts` | Modify | Support multiple terminal windows |
| `tray/src/main/index.ts` | Modify | Integrate MultiWindowCoordinator |

---

### Task 1: Default Tab Name "Main"

**Files:**
- Modify: `web/src/lib/workspaceTypes.ts:113`
- Test: `web/src/lib/workspaceStore.test.ts`

- [ ] **Step 1: Write the failing test**

In `web/src/lib/workspaceStore.test.ts`, add to the existing describe block:

```typescript
it('should create default workspace with tab named Main', () => {
  const ws = createDefaultWorkspace('test-session');
  expect(ws.tabs[0].name).toBe('Main');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run -t "should create default workspace with tab named Main"`
Expected: FAIL — tab name is `'Terminal 1'`

- [ ] **Step 3: Change default tab name**

In `web/src/lib/workspaceTypes.ts`, line 115, change:

```typescript
// FROM:
export function createDefaultWorkspace(initialSessionId?: SessionId): Workspace {
  const tab = createTab('Terminal 1', initialSessionId);
// TO:
export function createDefaultWorkspace(initialSessionId?: SessionId): Workspace {
  const tab = createTab('Main', initialSessionId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && pnpm test -- --run -t "should create default workspace with tab named Main"`
Expected: PASS

- [ ] **Step 5: Run full workspace test suite**

Run: `cd web && pnpm test -- --run workspaceStore`
Expected: All tests pass (check no other tests relied on "Terminal 1" name)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/workspaceTypes.ts web/src/lib/workspaceStore.test.ts
git commit -m "feat(web): rename default tab from 'Terminal 1' to 'Main'"
```

---

### Task 2: Lock Screen Auto-Recovery

**Files:**
- Modify: `web/src/components/Terminal.svelte:1043-1077`

- [ ] **Step 1: Enhance existing visibilitychange handler**

In `web/src/components/Terminal.svelte`, the existing handler at lines 1043-1077 calls `term.refresh()` but not `refreshTerminal()`. The fix is to call `refreshTerminal()` which does a full clear + re-attach + history replay, covering cases where the rendering pipeline is stale after lock screen.

Find the visibility handler (around line 1043). Gate `refreshTerminal()` behind a time check so it only fires after extended hidden periods (lock screen), not every tab switch:

```typescript
// Track when the page was last hidden
let hiddenSince: number | null = null;

// In the visibilityHandler:
if (document.visibilityState === 'hidden') {
  hiddenSince = Date.now();
} else if (document.visibilityState === 'visible') {
  // Only do full refresh if hidden for >5 seconds (lock screen, not tab switch)
  if (hiddenSince && (Date.now() - hiddenSince) > 5000) {
    refreshTerminal();
  }
  hiddenSince = null;
  // ... existing term.refresh() and resize logic stays
}
```

- [ ] **Step 2: Manual test**

Run: `pnpm dev`
1. Open browser to localhost:3001
2. Lock screen (Cmd+Ctrl+Q on macOS)
3. Unlock
4. Verify terminal content renders without needing Cmd+Shift+R

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Terminal.svelte
git commit -m "fix(web): auto-recover terminal after lock screen via visibilitychange"
```

---

### Task 3: Broadcast Default to All

**Files:**
- Modify: `web/src/lib/broadcastStore.svelte.ts:86-92`
- Test: `web/src/lib/__tests__/broadcastStore.test.ts`

- [ ] **Step 1: Write the failing test**

In `web/src/lib/__tests__/broadcastStore.test.ts`, add:

```typescript
it('broadcastInput sends to all sessions when no targets selected', () => {
  // Extend the existing mock with getLastSessionList
  const mockManager = {
    ...createMockManager(),
    getLastSessionList: vi.fn().mockReturnValue([
      { id: 'session-1' },
      { id: 'session-2' },
      { id: 'session-3' },
    ]),
  };
  setSessionManager(mockManager as any);
  // No targets added — targets.size === 0

  broadcastInput('hello\n');

  expect(mockManager.sendInput).toHaveBeenCalledTimes(3);
  expect(mockManager.sendInput).toHaveBeenCalledWith('session-1', 'hello\n');
  expect(mockManager.sendInput).toHaveBeenCalledWith('session-2', 'hello\n');
  expect(mockManager.sendInput).toHaveBeenCalledWith('session-3', 'hello\n');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run -t "sends to all sessions when no targets"`
Expected: FAIL — `sendInput` not called (current code skips when targets empty)

- [ ] **Step 3: Implement default-to-all**

In `web/src/lib/broadcastStore.svelte.ts`, modify `broadcastInput()` (line 86):

```typescript
export function broadcastInput(data: string): void {
  if (!sessionManager) return;

  const sessionIds = targets.size > 0
    ? targets
    : new Set(sessionManager.getLastSessionList().map(s => s.id));

  for (const sessionId of sessionIds) {
    sessionManager.sendInput(sessionId, data);
  }
}
```

- [ ] **Step 4: Run broadcast tests**

Run: `cd web && pnpm test -- --run broadcastStore`
Expected: All tests pass (existing + new)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/broadcastStore.svelte.ts web/src/lib/__tests__/broadcastStore.test.ts
git commit -m "feat(web): broadcast to all sessions when no targets selected"
```

---

### Task 4: Image Display Addon

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/components/Terminal.svelte:805-906`

- [ ] **Step 1: Install the addon**

Run: `cd web && pnpm add @xterm/addon-image`

- [ ] **Step 2: Import and load the addon in Terminal.svelte**

In `web/src/components/Terminal.svelte`, add import near the other addon imports (around line 8):

```typescript
import { ImageAddon } from '@xterm/addon-image';
```

Then in the addon loading section (after WebglAddon loading, around line 900), add:

```typescript
// Image display (SIXEL + iTerm2 IIP)
const imageAddon = new ImageAddon();
term.loadAddon(imageAddon);
```

- [ ] **Step 3: Manual test**

Run: `pnpm dev`
Open browser, in a terminal session run:
```bash
# If imgcat is installed:
imgcat some-image.png
# Or test with a SIXEL-capable tool
```

- [ ] **Step 4: Commit**

```bash
git add web/package.json web/pnpm-lock.yaml web/src/components/Terminal.svelte
git commit -m "feat(web): enable inline image display via @xterm/addon-image"
```

---

### Task 5: "(new)" Badge on Terminals

**Files:**
- Modify: `web/src/lib/workspaceStore.ts`
- Modify: `web/src/components/TerminalList.svelte`
- Test: `web/src/lib/workspaceStore.test.ts`

- [ ] **Step 1: Write failing tests**

In `web/src/lib/workspaceStore.test.ts`, add a new describe block:

```typescript
describe('newSessionFlags', () => {
  it('should mark a session as new', () => {
    workspaceStore.markSessionNew('session-1');
    expect(workspaceStore.isSessionNew('session-1')).toBe(true);
  });

  it('should clear new flag', () => {
    workspaceStore.markSessionNew('session-1');
    workspaceStore.clearSessionNew('session-1');
    expect(workspaceStore.isSessionNew('session-1')).toBe(false);
  });

  it('should return false for unknown sessions', () => {
    expect(workspaceStore.isSessionNew('unknown')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run -t "newSessionFlags"`
Expected: FAIL — methods don't exist

- [ ] **Step 3: Implement new session tracking in workspaceStore**

In `web/src/lib/workspaceStore.ts`, add inside `createWorkspaceStore()`. Use `$state` for Svelte 5 reactivity so templates re-render when the set changes:

```typescript
let newSessions = $state<Set<SessionId>>(new Set());

// Add to returned API object:
markSessionNew(sessionId: SessionId) {
  newSessions = new Set([...newSessions, sessionId]);
},
clearSessionNew(sessionId: SessionId) {
  const next = new Set(newSessions);
  next.delete(sessionId);
  newSessions = next;
},
isSessionNew(sessionId: SessionId): boolean {
  return newSessions.has(sessionId);
},
```

Note: We create new Set instances on mutation so Svelte 5 detects the change (Set mutation in-place doesn't trigger reactivity).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run -t "newSessionFlags"`
Expected: PASS

- [ ] **Step 5: Render badge in TerminalList.svelte**

In `web/src/components/TerminalList.svelte`, where the session name is rendered, add the "(new)" suffix:

```svelte
<!-- After the session name text, add: -->
{#if workspaceStore.isSessionNew(session.id)}
  <span class="new-badge"> (new)</span>
{/if}
```

Add minimal styling:

```css
.new-badge {
  color: var(--text-secondary, #888);
  font-style: italic;
}
```

- [ ] **Step 6: Clear flag on first input**

In the component or handler where `sendInput()` is called for a terminal (likely in `Terminal.svelte` or `App.svelte` where keyboard input is forwarded), add:

```typescript
// When user sends first input to a session:
if (workspaceStore.isSessionNew(sessionId)) {
  workspaceStore.clearSessionNew(sessionId);
}
```

Find where `manager.sendInput()` is called on user keypress. In `Terminal.svelte`, the `onData` handler (around where terminal input is captured) is the right place.

- [ ] **Step 7: Mark sessions as new on creation**

In `App.svelte`, where `createSession()` is called after the session is created and session ID is known (in the `sessionList` handler or after `createSession` call), add:

```typescript
workspaceStore.markSessionNew(newSessionId);
```

- [ ] **Step 8: Run full test suite**

Run: `cd web && pnpm test -- --run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/workspaceStore.ts web/src/lib/workspaceStore.test.ts \
  web/src/components/TerminalList.svelte web/src/components/Terminal.svelte \
  web/src/App.svelte
git commit -m "feat(web): show (new) badge on terminals until first input"
```

---

### Task 6: Split Inherits CWD

**Files:**
- Create: `web/src/lib/sessionCwdStore.svelte.ts`
- Create: `web/src/lib/__tests__/sessionCwdStore.test.ts`
- Modify: `web/src/App.svelte`
- Modify: `web/src/lib/workspaceStore.ts`

- [ ] **Step 1: Write failing tests for CWD store**

Create `web/src/lib/__tests__/sessionCwdStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { sessionCwdStore } from '../sessionCwdStore.svelte';

describe('sessionCwdStore', () => {
  beforeEach(() => {
    sessionCwdStore.clear();
  });

  it('should store and retrieve CWD for a session', () => {
    sessionCwdStore.set('session-1', '/home/user/project');
    expect(sessionCwdStore.get('session-1')).toBe('/home/user/project');
  });

  it('should return undefined for unknown sessions', () => {
    expect(sessionCwdStore.get('unknown')).toBeUndefined();
  });

  it('should update CWD when set again', () => {
    sessionCwdStore.set('session-1', '/home/user');
    sessionCwdStore.set('session-1', '/home/user/project');
    expect(sessionCwdStore.get('session-1')).toBe('/home/user/project');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm test -- --run sessionCwdStore`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement sessionCwdStore**

Create `web/src/lib/sessionCwdStore.svelte.ts`:

```typescript
const cwdMap = new Map<string, string>();

export const sessionCwdStore = {
  set(sessionId: string, cwd: string) {
    cwdMap.set(sessionId, cwd);
  },
  get(sessionId: string): string | undefined {
    return cwdMap.get(sessionId);
  },
  clear() {
    cwdMap.clear();
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run sessionCwdStore`
Expected: PASS

- [ ] **Step 5: Wire CWD store to cwdChanged events in App.svelte**

In `web/src/App.svelte`, in the `setupManagerEvents()` function, find the `cwdChanged` handler (around line 488) and add:

```typescript
import { sessionCwdStore } from './lib/sessionCwdStore.svelte';

// In the cwdChanged handler:
manager.on('cwdChanged', (sessionId, cwd) => {
  sessionCwdStore.set(sessionId, cwd);
  // ... existing sessions update logic
});
```

- [ ] **Step 6: Pass CWD when splitting**

In `web/src/App.svelte` or wherever `splitPane` triggers session creation, find the split handler. When creating a new session for a split:

```typescript
// Get the source pane's session CWD
const sourceCwd = sessionCwdStore.get(sourceSessionId) ?? defaultCwd;
manager.createSession(sourceCwd, shell, env, cols, rows);
```

The exact location depends on how splitPane connects to session creation. Look for where `workspaceStore.splitPane()` is called and a new session is created afterward.

- [ ] **Step 7: Manual test**

Run: `pnpm dev`
1. Open terminal, `cd /tmp`
2. Split the pane (Cmd+D or equivalent)
3. Verify new terminal opens in `/tmp`, not `~`

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/sessionCwdStore.svelte.ts web/src/lib/__tests__/sessionCwdStore.test.ts \
  web/src/App.svelte
git commit -m "feat(web): new terminals from split inherit source session CWD"
```

---

### Task 7: Sidebar Session Reordering

**Files:**
- Modify: `web/src/lib/workspaceTypes.ts:44-49`
- Modify: `web/src/lib/workspaceStore.ts`
- Modify: `web/src/components/TerminalList.svelte`
- Test: `web/src/lib/workspaceStore.test.ts`

- [ ] **Step 1: Add sessionOrder to Tab type**

In `web/src/lib/workspaceTypes.ts`, update the Tab interface (line 44):

```typescript
export interface Tab {
  id: TabId;
  name: string;
  root: SplitNode;
  sessionOrder: string[];  // display order of all sessions in this tab
}
```

Update `createTab()` (line 102) to initialize sessionOrder:

```typescript
export function createTab(name: string, sessionId?: SessionId): Tab {
  const pane = createPane(sessionId ?? null);
  return {
    id: crypto.randomUUID(),
    name,
    root: pane,
    sessionOrder: sessionId ? [sessionId] : [],
  };
}
```

**Migration for persisted workspaces:** In `workspaceStore.ts`, in the `loadFromCache()` function (line 30), add a migration step after loading:

```typescript
// After loading workspace from localStorage/server:
for (const tab of workspace.tabs) {
  if (!tab.sessionOrder) {
    // Migrate: derive sessionOrder from pane tree
    tab.sessionOrder = getAllPanes(tab.root)
      .filter(p => p.sessionId)
      .map(p => p.sessionId!);
  }
}
```

**Keep sessionOrder in sync:** In the following workspace mutation methods, also update `sessionOrder`:

- `splitPane()` / `splitPaneBefore()` — when a new session is created, push its ID to `tab.sessionOrder`
- `closePane()` / `detachPane()` — when a session is removed from a pane, leave it in `sessionOrder` (it becomes unassigned)
- `assignSession()` — if the session is new to this tab, add to `sessionOrder`
- `clearStaleSessions()` — remove stale IDs from `sessionOrder`

- [ ] **Step 2: Write failing tests for reorder and move**

In `web/src/lib/workspaceStore.test.ts`:

```typescript
describe('session reordering', () => {
  it('should reorder sessions within a tab', () => {
    // Setup: create tab with multiple sessions
    const tab = workspaceStore.get().tabs[0];
    const pane2 = workspaceStore.splitPane(tab.root.id, 'horizontal', 'session-b');

    const updatedTab = workspaceStore.get().tabs[0];
    const orderBefore = [...updatedTab.sessionOrder];

    workspaceStore.reorderSession(updatedTab.id, 0, 1);

    const afterTab = workspaceStore.get().tabs[0];
    expect(afterTab.sessionOrder[0]).toBe(orderBefore[1]);
    expect(afterTab.sessionOrder[1]).toBe(orderBefore[0]);
  });

  it('should move a session to another tab', () => {
    const tabId2 = workspaceStore.createTab('Tab 2', 'session-c');
    const tab1 = workspaceStore.get().tabs[0];
    const sessionToMove = tab1.sessionOrder[0];

    workspaceStore.moveSessionToTab(sessionToMove, tab1.id, tabId2);

    const updated = workspaceStore.get();
    const destTab = updated.tabs.find(t => t.id === tabId2)!;
    expect(destTab.sessionOrder).toContain(sessionToMove);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run -t "session reordering"`
Expected: FAIL — methods don't exist

- [ ] **Step 4: Implement reorderSession and moveSessionToTab**

In `web/src/lib/workspaceStore.ts`, add methods to the store:

```typescript
reorderSession(tabId: TabId, fromIndex: number, toIndex: number) {
  const ws = structuredClone(workspace);
  const tab = ws.tabs.find(t => t.id === tabId);
  if (!tab || fromIndex === toIndex) return;
  const [moved] = tab.sessionOrder.splice(fromIndex, 1);
  tab.sessionOrder.splice(toIndex, 0, moved);
  update(ws);
},

moveSessionToTab(sessionId: SessionId, fromTabId: TabId, toTabId: TabId) {
  const ws = structuredClone(workspace);
  const fromTab = ws.tabs.find(t => t.id === fromTabId);
  const toTab = ws.tabs.find(t => t.id === toTabId);
  if (!fromTab || !toTab) return;

  // Remove from source tab's session order
  fromTab.sessionOrder = fromTab.sessionOrder.filter(id => id !== sessionId);

  // Detach from source tab's pane tree if assigned
  // (reuse existing detach logic)

  // Add to destination tab's session order
  toTab.sessionOrder.push(sessionId);

  update(ws);
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run -t "session reordering"`
Expected: PASS

- [ ] **Step 6: Add drag-drop handlers to TerminalList.svelte**

In `web/src/components/TerminalList.svelte`, add drag source on session items:

```svelte
<!-- On each session list item: -->
<div
  class="session-item"
  draggable="true"
  ondragstart={(e) => handleSessionDragStart(e, session.id)}
  ondragover={(e) => handleSessionDragOver(e, index)}
  ondrop={(e) => handleSessionDrop(e, index)}
>
```

Add handlers:

```typescript
let draggedSessionIndex: number | null = null;

function handleSessionDragStart(event: DragEvent, sessionId: string) {
  draggedSessionIndex = sessions.findIndex(s => s.id === sessionId);
  event.dataTransfer?.setData('text/plain', sessionId);
  event.dataTransfer?.setData('application/x-terminar-session', sessionId);
}

function handleSessionDragOver(event: DragEvent, index: number) {
  if (draggedSessionIndex === null) return;
  event.preventDefault();
  // Visual indicator for drop position
}

function handleSessionDrop(event: DragEvent, toIndex: number) {
  if (draggedSessionIndex === null) return;
  event.preventDefault();
  const activeTabId = workspaceStore.get().activeTabId;
  workspaceStore.reorderSession(activeTabId, draggedSessionIndex, toIndex);
  draggedSessionIndex = null;
}
```

- [ ] **Step 7: Change click to assign-to-focused-pane**

In `web/src/components/TerminalList.svelte`, change the click handler from switching the active session to assigning the clicked session to the currently focused pane:

```typescript
// BEFORE: onselect?.(session.id)  — switches active terminal
// AFTER:
function handleSessionClick(sessionId: string) {
  // Assign to focused pane
  const focusedPaneId = focusedPane.id;
  if (focusedPaneId) {
    workspaceStore.assignSession(focusedPaneId, sessionId);
  }
}
```

- [ ] **Step 8: Run full test suite**

Run: `cd web && pnpm test -- --run`
Expected: All tests pass

- [ ] **Step 9: Manual test**

Run: `pnpm dev`
1. Create multiple terminals
2. Drag sessions up/down in sidebar — verify reorder
3. Click a session — verify it replaces the focused pane's content
4. Create a second tab, drag a session onto the tab header — verify it moves

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/workspaceTypes.ts web/src/lib/workspaceStore.ts \
  web/src/lib/workspaceStore.test.ts web/src/components/TerminalList.svelte
git commit -m "feat(web): sidebar drag-drop reordering and click-to-assign"
```

---

### Task 8: Sidebar Session-to-Pane Drop + Between-Tab Moves

**Files:**
- Modify: `web/src/components/Pane.svelte:330-353`
- Modify: `web/src/components/TerminalList.svelte`

- [ ] **Step 1: Ensure Pane.svelte accepts sidebar session drops**

In `web/src/components/Pane.svelte`, the `handleDrop` function (line 330) already handles `text/plain` data transfer with a session ID. Verify this path works:

```typescript
// Existing code (lines 340-352):
const dragSessionId = event.dataTransfer?.getData('text/plain');
if (dragSessionId) {
  paneActions.drop(paneId, dragSessionId, dropZone);
}
```

This should already work when dragging a session from the sidebar (since TerminalList drag sets `text/plain` to sessionId). Test by dragging a session from sidebar onto a pane.

- [ ] **Step 2: Add tab header drop targets for between-tab moves**

In `web/src/components/TerminalList.svelte` (or wherever tab headers in the sidebar are rendered), add drop handlers on tab group headers:

```svelte
<!-- On tab group header in sidebar: -->
<div
  class="tab-group-header"
  ondragover={(e) => {
    if (e.dataTransfer?.types.includes('application/x-terminar-session')) {
      e.preventDefault();
    }
  }}
  ondrop={(e) => {
    const sessionId = e.dataTransfer?.getData('application/x-terminar-session');
    if (sessionId) {
      const fromTabId = workspaceStore.get().activeTabId;
      workspaceStore.moveSessionToTab(sessionId, fromTabId, tab.id);
    }
  }}
>
```

- [ ] **Step 3: Add visual distinction for assigned vs unassigned sessions**

In `web/src/components/TerminalList.svelte`, check if a session is assigned to any pane in the current tab:

```svelte
{@const assignedSessionIds = getWorkspaceSessionIds(workspaceStore.get())}

<div class="session-item" class:assigned={assignedSessionIds.includes(session.id)}>
```

```css
.session-item.assigned {
  opacity: 0.6;
}
```

- [ ] **Step 4: Manual test**

Run: `pnpm dev`
1. Drag session from sidebar onto a pane — verify it replaces that pane's session
2. Drag session onto a different tab header — verify it moves to that tab
3. Verify assigned sessions appear dimmed in sidebar

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Pane.svelte web/src/components/TerminalList.svelte
git commit -m "feat(web): drag sessions to panes and between tabs"
```

---

### Task 9: Multi-Window Support (Electron)

**Files:**
- Create: `tray/src/main/MultiWindowCoordinator.ts`
- Modify: `tray/src/main/WindowManager.ts`
- Modify: `tray/src/main/index.ts`
- Test: `tray/src/main/__tests__/MultiWindowCoordinator.test.ts` (if test dir exists)

- [ ] **Step 1: Create MultiWindowCoordinator**

Create `tray/src/main/MultiWindowCoordinator.ts`:

```typescript
import { BrowserWindow, ipcMain } from 'electron';

interface WindowTabMapping {
  windowId: number;
  tabId: string;
}

export class MultiWindowCoordinator {
  private mappings: WindowTabMapping[] = [];
  private windows: Map<number, BrowserWindow> = new Map();

  /**
   * Register a window showing a specific tab
   */
  register(win: BrowserWindow, tabId: string) {
    this.windows.set(win.id, win);
    this.mappings.push({ windowId: win.id, tabId });

    win.on('closed', () => {
      this.windows.delete(win.id);
      this.mappings = this.mappings.filter(m => m.windowId !== win.id);
    });
  }

  /**
   * Get the tab ID shown in a window
   */
  getTabForWindow(windowId: number): string | undefined {
    return this.mappings.find(m => m.windowId === windowId)?.tabId;
  }

  /**
   * Get the next tab not currently shown in any window.
   * Returns null if all tabs are shown.
   */
  getNextAvailableTab(allTabIds: string[]): string | null {
    const shownTabs = new Set(this.mappings.map(m => m.tabId));
    return allTabIds.find(id => !shownTabs.has(id)) ?? null;
  }

  /**
   * How many terminal windows are open
   */
  get windowCount(): number {
    return this.windows.size;
  }

  /**
   * Broadcast a workspace mutation to all windows except the source
   */
  broadcastToOthers(sourceWindowId: number, channel: string, ...args: unknown[]) {
    for (const [id, win] of this.windows) {
      if (id !== sourceWindowId && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }

  /**
   * Setup IPC handlers for cross-window coordination
   */
  setupIpc() {
    ipcMain.handle('multi-window:get-tab', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return win ? this.getTabForWindow(win.id) : null;
    });

    ipcMain.on('multi-window:workspace-mutation', (event, mutation) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        this.broadcastToOthers(win.id, 'multi-window:workspace-updated', mutation);
      }
    });
  }
}
```

- [ ] **Step 2: Write tests for MultiWindowCoordinator**

Create `tray/src/main/__tests__/MultiWindowCoordinator.test.ts` (or add to existing test file):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiWindowCoordinator } from '../MultiWindowCoordinator';

function mockWindow(id: number) {
  const handlers: Record<string, Function> = {};
  return {
    id,
    on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
    _trigger: (event: string) => handlers[event]?.(),
  };
}

describe('MultiWindowCoordinator', () => {
  let coordinator: MultiWindowCoordinator;

  beforeEach(() => {
    coordinator = new MultiWindowCoordinator();
  });

  it('should register and track windows', () => {
    const win = mockWindow(1);
    coordinator.register(win as any, 'tab-main');
    expect(coordinator.getTabForWindow(1)).toBe('tab-main');
    expect(coordinator.windowCount).toBe(1);
  });

  it('should find next available tab', () => {
    const win = mockWindow(1);
    coordinator.register(win as any, 'tab-main');
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBe('tab-dev');
  });

  it('should return null when all tabs shown', () => {
    coordinator.register(mockWindow(1) as any, 'tab-main');
    coordinator.register(mockWindow(2) as any, 'tab-dev');
    expect(coordinator.getNextAvailableTab(['tab-main', 'tab-dev'])).toBeNull();
  });

  it('should clean up on window close', () => {
    const win = mockWindow(1);
    coordinator.register(win as any, 'tab-main');
    win._trigger('closed');
    expect(coordinator.windowCount).toBe(0);
  });

  it('should broadcast to other windows', () => {
    const win1 = mockWindow(1);
    const win2 = mockWindow(2);
    coordinator.register(win1 as any, 'tab-main');
    coordinator.register(win2 as any, 'tab-dev');

    coordinator.broadcastToOthers(1, 'update', { data: 'test' });

    expect(win1.webContents.send).not.toHaveBeenCalled();
    expect(win2.webContents.send).toHaveBeenCalledWith('update', { data: 'test' });
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd tray && pnpm test -- --run MultiWindowCoordinator`
Expected: PASS

- [ ] **Step 4: Refactor WindowManager to support multiple terminal windows**

In `tray/src/main/WindowManager.ts`, modify `openTerminal()` to allow multiple windows:

```typescript
// BEFORE: Early return if terminal window exists
// AFTER: Create a new terminal window each time, with unique label

openTerminal(tabId?: string): BrowserWindow {
  const label = `terminal-${Date.now()}`;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // ... existing config
  });

  this.registerWindow(label, win);

  // Pass tabId as query param so the renderer knows which tab to show
  const url = tabId
    ? `${this.baseUrl}?tab=${tabId}`
    : this.baseUrl;
  this.loadUrl(win, url);

  return win;
}
```

- [ ] **Step 5: Integrate coordinator into app lifecycle**

In `tray/src/main/index.ts`, add:

```typescript
import { MultiWindowCoordinator } from './MultiWindowCoordinator';

// In app.whenReady():
const multiWindow = new MultiWindowCoordinator();
multiWindow.setupIpc();

// Add IPC handler for renderer to report its tab IDs
ipcMain.handle('multi-window:get-all-tabs', async (event) => {
  // Ask the first (primary) window for tab IDs
  const primaryWin = [...multiWindow.windows.values()][0];
  if (!primaryWin || primaryWin.isDestroyed()) return [];
  return await primaryWin.webContents.invoke('workspace:get-tab-ids');
});

// Register Cmd+N shortcut for new window
globalShortcut.register('CommandOrControl+N', async () => {
  // Get tab IDs from the primary renderer window via IPC round-trip
  const primaryWin = windowManager.getWindow('terminal-primary');
  if (!primaryWin || primaryWin.isDestroyed()) return;

  const allTabIds: string[] = await primaryWin.webContents.executeJavaScript(
    'window.__terminar?.getTabIds?.() ?? []'
  );

  const nextTab = multiWindow.getNextAvailableTab(allTabIds);

  if (!nextTab) {
    // No unshown tab — ask renderer to create a new tab, get its ID back
    const newTabId: string = await primaryWin.webContents.executeJavaScript(
      'window.__terminar?.createTab?.() ?? ""'
    );
    if (newTabId) {
      const win = windowManager.openTerminal(newTabId);
      multiWindow.register(win, newTabId);
    }
  } else {
    const win = windowManager.openTerminal(nextTab);
    multiWindow.register(win, nextTab);
  }
});
```

**Renderer bridge:** In the web frontend, expose tab operations on `window.__terminar` so the main process can query them:

```typescript
// In App.svelte onMount or a dedicated bridge module:
(window as any).__terminar = {
  getTabIds: () => workspaceStore.get().tabs.map(t => t.id),
  createTab: () => workspaceStore.createTab(),
};
```

**Preload script:** Add IPC channel exposure in `tray/src/preload/index.ts`:

```typescript
contextBridge.exposeInMainWorld('multiWindow', {
  getAssignedTab: () => ipcRenderer.invoke('multi-window:get-tab'),
  onWorkspaceUpdated: (callback: Function) =>
    ipcRenderer.on('multi-window:workspace-updated', (_event, mutation) => callback(mutation)),
});
```

- [ ] **Step 6: Manual test**

Run: `pnpm dev:tray`
1. Open tray app
2. Cmd+N — verify second window opens on a new tab
3. Verify both windows share the same sessions
4. Close second window — verify first window unaffected

- [ ] **Step 7: Commit**

```bash
git add tray/src/main/MultiWindowCoordinator.ts \
  tray/src/main/__tests__/MultiWindowCoordinator.test.ts \
  tray/src/main/WindowManager.ts tray/src/main/index.ts
git commit -m "feat(tray): multi-window support with tab-based window model"
```

---

## Execution Order

1. **Task 1** — Default tab name (trivial, 2 min)
2. **Task 2** — Lock screen recovery (trivial, 3 min)
3. **Task 3** — Broadcast default to all (small, 5 min)
4. **Task 4** — Image display addon (trivial, 3 min)
5. **Task 5** — "(new)" badge (small, 10 min)
6. **Task 6** — Split inherits CWD (small, 10 min)
7. **Task 7** — Sidebar reordering (medium, 20 min)
8. **Task 8** — Sidebar session-to-pane drop (medium, 15 min)
9. **Task 9** — Multi-window (large, 30 min)

Tasks 1-6 are independent and can run in parallel.
Tasks 7-8 are sequential (7 before 8).
Task 9 is independent of all others.
