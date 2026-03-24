# UX Improvements: Multi-Window, Sidebar, and Polish

**Date:** 2026-03-21
**Status:** Approved

## Overview

A batch of UX improvements to the terminar web and Electron frontends. The largest piece is multi-window support in Electron; the rest are smaller improvements to sidebar interaction, broadcast, terminal creation, and display.

## Features

### 1. Multi-Window Support (Electron)

**Model:** One shared workspace, windows are viewports into tabs.

**Architecture:**

```
┌─────────────────────────────────────────────┐
│            Electron Main Process            │
│  ┌───────────────────────────────────────┐  │
│  │   MultiWindowCoordinator (new module)  │  │
│  │  - tracks BrowserWindow instances     │  │
│  │  - assigns tabs to windows            │  │
│  │  - IPC hub for workspace sync         │  │
│  └───────────────────────────────────────┘  │
│         ▲              ▲            ▲       │
│    IPC  │         IPC  │       IPC  │       │
│         ▼              ▼            ▼       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Window 1 │  │ Window 2 │  │ Window 3 │  │
│  │(Tab: Main)│ │(Tab: Dev) │ │(Tab: Logs)│  │
│  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────┘
         │ All windows share one WebSocket
         ▼
   terminar-server (PTY sessions)
```

**Key behaviors:**

- **New window** (Cmd+N): If 1 tab exists, create "Tab 2" and open the new window on it. If multiple tabs exist, open on the next tab not currently shown in any window.
- **Close window:** The tab remains in the workspace. Only the viewport closes.
- **Drag terminal between windows:** Moves the session from the source tab to the destination tab via IPC. Both windows update their workspace state.
- **Single WebSocket:** All windows share one connection to the server via the main process. Renderer windows communicate through IPC; the main process relays to/from the socket.

**New files:**

- `tray/src/main/MultiWindowCoordinator.ts` — tab-to-window mapping, IPC hub for workspace sync across terminal windows

**Modified files:**

- `tray/src/main/WindowManager.ts` — refactor `openTerminal()` to support multiple concurrent terminal windows (currently enforces a single terminal window via early-return). Add Cmd+N handler that delegates to MultiWindowCoordinator for tab assignment.
- `web/src/lib/workspaceStore.ts` — add IPC listeners for cross-window workspace mutations
- `tray/src/main/index.ts` — integrate MultiWindowCoordinator into app lifecycle

### 2. Sidebar Reordering

Three drag-drop capabilities using existing HTML5 drag-drop patterns from the pane code.

**A. Reorder sessions within a tab:**

- Drag handle on each session item in `TerminalList.svelte`
- `dragstart` / `dragover` / `drop` handlers update session display order
- Persist order in workspace store via a new `sessionOrder: string[]` per tab

**B. Move sessions between tabs:**

- Drag a session item and drop it on a different tab header
- On drop: remove session from source tab's pane tree, add to destination tab
- If the session was in a split, the split collapses to fill the gap

**C. Reorder tab headers:**

- Tab headers become draggable
- Drag left/right to reorder
- Updates `tabs` array order in workspace store

**Sidebar click behavior change:**

- **Click a session:** Assigns the session to the currently focused pane (replaces the pane's current session). This preserves keyboard accessibility — users don't need drag-and-drop to assign sessions.
- **Drag session onto a pane:** Replaces that pane's session with the dragged one. The previous session returns to the unassigned pool.
- **Drag session onto a split zone:** Creates a new split with the dragged session.
- **Visual distinction:** Sessions assigned to a pane appear dimmed or with a pane indicator. Unassigned sessions appear fully visible.

**Modified files:**

- `web/src/components/TerminalList.svelte` — remove click-to-switch, add drag source handlers, add drag handles
- `web/src/components/Pane.svelte` — add drop target handlers to accept sessions from sidebar
- `web/src/components/TabBar.svelte` — add drag handlers for tab header reordering
- `web/src/lib/workspaceStore.ts` — add `reorderSession()`, `moveSessionToTab()`, `reorderTab()` methods
- `web/src/lib/workspaceTypes.ts` — add `sessionOrder: string[]` field to tab type (tracks display order of all sessions belonging to this tab, both assigned-to-pane and unassigned)

All ordering persists to localStorage with the rest of the workspace state.

### 3. Lock Screen Auto-Recovery

- Add `document.addEventListener('visibilitychange', ...)` in `Terminal.svelte`
- When `!document.hidden`, call existing `refreshTerminal()`
- Replaces the need for manual Cmd+Shift+R

### 4. Image Display

- Install `@xterm/addon-image` in `web/`
- Load the addon in `Terminal.svelte` alongside existing addons (FitAddon, WebglAddon, SearchAddon, Unicode11Addon)
- Supports SIXEL and iTerm2 Inline Image Protocol
- Zero server changes — escape sequences pass through as-is

### 5. Broadcast: Default to All

- In `broadcastInput()` in `broadcastStore.svelte.ts`: if `targets.size === 0`, get all session IDs via `sessionManager.getActiveSessions()` (or equivalent enumeration method) and iterate those instead
- When broadcast mode is on with no checkboxes selected, input goes to every session

### 6. Default Tab Name

- Change `'Terminal 1'` to `'Main'` in `workspaceStore.ts` where the initial tab is created

### 7. Split Inherits CWD

- Add a client-side `sessionCwdMap: Map<string, string>` (session ID → CWD) to the session metadata store, updated on `CwdChanged` events from the WebSocket manager
- When splitting a pane, look up the source session's CWD from `sessionCwdMap`
- Pass that CWD to `createSession()` so the new terminal opens in the same directory
- Fallback: if CWD is unknown (no `CwdChanged` received yet), use the user's home directory

**Modified files:**

- `web/src/lib/sessionStore.ts` or equivalent — add `sessionCwdMap`, subscribe to `cwdChanged` events
- `web/src/lib/workspaceStore.ts` — `splitPane()` reads source CWD from map and passes to session creation

### 8. "(new)" Badge on Terminals

- Add `isNew: boolean` flag per session in client-side session metadata, default `true` on creation
- Sidebar renders `"Terminal 4 (new)"` when flag is true
- On first `sendInput()` call for that session, set `isNew = false` and badge disappears
- No persistence needed — badge is transient within a session lifecycle

**Modified files:**

- `web/src/lib/workspaceStore.ts` or session metadata store — `isNew` flag
- `web/src/components/TerminalList.svelte` — render `(new)` suffix
- `web/src/components/Terminal.svelte` or input handler — clear flag on first input

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multi-window architecture | Shared workspace via IPC | User expects one workspace; tabs are viewports. Standard Electron pattern. |
| Sidebar drag-drop implementation | HTML5 drag-drop API | Already used for pane reordering. No new dependencies. |
| "(new)" badge tracking | Client-side flag | Purely cosmetic. No server involvement needed. |
| Sidebar click behavior | Click assigns to focused pane; drag for targeted assignment | Sidebar is a session pool. Click provides keyboard-accessible assignment; drag provides targeted pane assignment. |
| Broadcast with no targets | Send to all sessions | Intuitive default. Matches user expectation of "broadcast". |
| Image protocol | @xterm/addon-image (SIXEL + iTerm2 IIP) | Actively maintained, works transparently with existing server. |

## Out of Scope

- Server-side workspace state / sync (not needed for client-side multi-window)
- Multi-user multi-window (gateway mode)
- Custom image rendering UI (addon handles it)
- Broadcast UX polish beyond default-to-all (functional, not broken)
