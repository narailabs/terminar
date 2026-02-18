# TDD Plan: terminar v1 Features

## Scope

All v1 features from the tmux gap analysis + coding agent detection. Server (Rust) + Web UI (Svelte) only. VS Code extension deferred.

## Source Documents

- `apps/terminar/docs/plans/tmux-feature-gaps.md`
- `apps/terminar/docs/plans/coding-agent-detection.md`

## Test Frameworks

- **Rust server:** `#[tokio::test]`, `serial_test`, `criterion` (bench)
- **Web UI:** `vitest`, `@testing-library/svelte`, `jsdom`
- **Protocol:** `vitest` (in `packages/shell-protocol`)

## Feature Dependency Graph

```
                    ┌──────────────────────┐
                    │ F1: Protocol changes │ (SessionInfo extensions,
                    │     (foundation)      │  new message types)
                    └──────┬───────────────┘
                           │
          ┌────────────────┼────────────────┬──────────────────┐
          ▼                ▼                ▼                  ▼
   F2: Foreground    F3: Activity     F5: Remain        F8: Workspace
   Process Detection Monitoring       on Exit            Persistence
   (server)          (server)         (server)           (server API)
          │                │                │                  │
          ▼                ▼                ▼                  ▼
   F9: Agent         F3c: Activity    F5c: Exit          F8c: Restore
   Detection         Indicators       UI                 on Reconnect
   (web UI)          (web UI)         (web UI)           (web UI)
                                                              │
   ┌──────────────────────────────────────────────────────────┘
   │ (independent of above)
   ▼
   F4: Search in Scrollback (web, xterm-addon-search)
   F6: Status Bar (web)
   F7: Key Binding Customization (web)
   F10: Synchronized Input / Broadcast (web)
   F11: Environment Variable Management (web + protocol)
```

---

## F1: Protocol Changes (Foundation)

Extends `SessionInfo` and adds new message types needed by multiple features. Must be done first.

### F1a: Protocol Schema Updates (shell-protocol)

**Tests:**
1. `SessionInfo` schema accepts `foreground_process` as optional string
2. `SessionInfo` schema accepts `state` field (for Exited state)
3. `SessionInfo` schema accepts `last_activity_at` as optional string (ISO timestamp)
4. New `ForegroundChanged` server message validates with `session_id` + `process_name`
5. New `SessionActivity` server message validates with `session_id` + `type` (activity | bell | silence)
6. New `SessionExited` server message validates with `session_id` + `exit_code`
7. New `save_workspace` client message validates with `workspace` object
8. New `load_workspace` client message validates (no params)
9. New `WorkspaceData` server message validates with workspace payload
10. All new fields are backward-compatible (existing messages without new fields still parse)

**Implementation:**
- Add fields to `SessionInfoSchema` in `messages.ts`
- Add new message variants to `ServerMessageSchema` and `ClientMessageSchema`
- Add corresponding Rust types in `server/src/messages.rs`
- Bump protocol version if applicable

### F1b: Rust Message Types

**Tests:**
1. `SessionInfo` serializes/deserializes with `foreground_process: Some("claude")`
2. `SessionInfo` serializes/deserializes with `foreground_process: None` (backward compat)
3. `SessionInfo` includes `state` field matching `SessionState` display name
4. `SessionInfo` includes `last_activity_at` field
5. `ForegroundChanged` message serializes correctly
6. `SessionActivity` message serializes correctly
7. `SessionExited` message serializes correctly
8. `SaveWorkspace` / `LoadWorkspace` / `WorkspaceData` messages round-trip

**Implementation:**
- Extend `SessionInfo` struct in `messages.rs`
- Add new variants to `ServerMessage` and `ClientMessage` enums
- Update `build_session_list()` in `handlers/session.rs`

---

## F2: Foreground Process Detection (Server)

Server-side polling of `tcgetpgrp()` to detect the foreground process.

### F2a: Foreground Process Resolution (Server)

**Tests:**
1. `get_foreground_process()` returns `None` for invalid file descriptor
2. `get_foreground_process()` returns the shell name (e.g., `zsh`, `bash`) for an idle PTY
3. `resolve_process_name()` returns process name from PID on Linux (mock `/proc/<pid>/comm`)
4. `resolve_process_name()` falls back to cmdline when comm is `node` or `python`
5. `resolve_process_name()` returns `None` when PID doesn't exist
6. `extract_binary_name_from_cmdline()` extracts `gemini` from `/usr/local/bin/node /usr/local/bin/gemini`
7. `extract_binary_name_from_cmdline()` extracts `aider` from `/usr/bin/python3 /usr/local/bin/aider`
8. `extract_binary_name_from_cmdline()` handles edge cases (empty cmdline, single arg)

**Implementation:**
- New module `server/src/process.rs`
- `get_foreground_process(pty_fd: RawFd) -> Option<String>` using `nix::unistd::tcgetpgrp`
- `resolve_process_name(pid: i32) -> Option<String>` with platform-specific implementations
- `extract_binary_name_from_cmdline(cmdline: &str) -> Option<String>` for Node.js/Python fallback
- `#[cfg(target_os = "linux")]` and `#[cfg(target_os = "macos")]` branches

### F2b: Foreground Polling Task (Server)

**Tests:**
1. Polling task updates `Session.foreground_process` field every N seconds
2. Polling task skips sessions in `Closed` or `Error` state
3. Polling task sends `ForegroundChanged` notification when process name changes
4. Polling task does NOT send notification when process name is unchanged
5. Polling interval is configurable (default 2 seconds)
6. Polling task handles session being removed mid-poll gracefully
7. `SessionInfo` returned by `list_sessions` includes current `foreground_process`

**Implementation:**
- Add `foreground_process: Option<String>` field to `Session` struct
- Add `pty_fd: Option<RawFd>` field to `Session` struct (capture at creation time)
- Spawn a `tokio::spawn` background task in `lib.rs` server startup
- Task iterates sessions, calls `get_foreground_process()`, updates state, broadcasts changes

---

## F3: Activity Monitoring (Server + Web)

### F3a: Activity Tracking (Server)

**Tests:**
1. `Session` tracks `last_output_at` timestamp, updated on every output event
2. `Session` tracks `last_bell_at` timestamp, updated when bell character (`\x07`) detected in output
3. Server detects bell character in PTY output stream
4. `SessionInfo` includes `last_activity_at` field
5. Silence detection: server emits `SessionActivity { type: silence }` when no output for N seconds
6. Activity detection: server emits `SessionActivity { type: activity }` on first output after silence
7. Bell detection: server emits `SessionActivity { type: bell }` when bell detected
8. Silence threshold is configurable per-session (default: 30 seconds)
9. Silence timer resets on each output event
10. No activity notifications sent for sessions with no attached clients

**Implementation:**
- Add `last_output_at: Option<Instant>` and `last_bell_at: Option<Instant>` to `Session`
- Scan PTY output for `\x07` in the reader task (already processes output bytes)
- Background silence-checker task: iterate sessions, compare `last_output_at` against threshold
- Broadcast `SessionActivity` messages to attached clients

### F3b: Activity Indicators (Web UI)

**Tests:**
1. Tab shows activity dot badge when `SessionActivity { type: activity }` received for a background tab
2. Tab shows bell icon when `SessionActivity { type: bell }` received
3. Tab shows silence indicator (e.g., dimmed or "zzz") when `SessionActivity { type: silence }` received
4. Activity badge clears when tab becomes active (user switches to it)
5. Sidebar session item shows activity indicators matching tab badges
6. Activity indicators do NOT show for the currently focused session
7. System notification fires on bell event if `terminar.notifications` setting is enabled
8. System notification does NOT fire if browser Notification permission is denied

**Implementation:**
- New Svelte store `activityStore` tracking per-session activity state
- Update `TabBar` component to render badges based on activity state
- Update `Sidebar` / `TerminalList` to show indicators
- Browser Notification API integration (with permission request)
- Settings toggle for notifications

---

## F4: Search in Scrollback (Web UI)

### F4a: Search Bar Component

**Tests:**
1. Ctrl-F (or Cmd-F) opens search bar overlay on the active terminal pane
2. Search bar has text input, "Previous" button, "Next" button, "Close" button
3. Search bar shows match count (e.g., "3 of 17")
4. Typing in search bar triggers incremental search (debounced 150ms)
5. "Next" button (or Enter) moves to next match
6. "Previous" button (or Shift-Enter) moves to previous match
7. Escape closes the search bar and clears highlights
8. Search bar does not steal focus from terminal when closed
9. Case-insensitive search by default
10. Optional regex toggle button

**Implementation:**
- Install `@xterm/addon-search` package
- New `SearchBar.svelte` component
- Integrate with `Pane.svelte` — attach search addon to xterm instance
- Key event handling via xterm's `registerCustomKeyEventHandler` to intercept Ctrl-F

### F4b: Search Addon Integration

**Tests:**
1. Search addon is loaded when terminal initializes
2. `findNext(term)` highlights matches in terminal buffer
3. `findPrevious(term)` navigates backward through matches
4. Clearing search input removes all highlights
5. Search works across scrollback history (not just visible viewport)
6. Search persists when terminal receives new output (re-runs on new content)

**Implementation:**
- Initialize `SearchAddon` in terminal setup
- Wire search bar input → `addon.findNext()` / `addon.findPrevious()`
- Handle match count updates from addon callbacks

---

## F5: Remain-on-Exit (Server + Web)

### F5a: Exited Session State (Server)

**Tests:**
1. New `SessionState::Exited` variant exists with `exit_code: Option<i32>`
2. `Running` → `Exited` is a valid state transition
3. `Exited` → `Closed` is a valid state transition (user manually closes)
4. When PTY child process exits, session transitions to `Exited` (not `Closed`)
5. `Exited` session retains history buffer (not freed)
6. `Exited` session rejects `input` messages with an error
7. `Exited` session still allows `attach` (for read-only viewing)
8. `SessionExited` notification sent to all attached clients with exit code
9. `SessionInfo` includes state="exited" for exited sessions
10. Auto-cleanup: `Exited` sessions transition to `Closed` after configurable timeout (default: none / infinite)
11. `kill_session` on an `Exited` session transitions to `Closed` and frees resources

**Implementation:**
- Add `Exited { exit_code: Option<i32> }` to `SessionState` enum
- Update state transition logic in `can_transition_to()`
- Modify PTY reader task: on child exit, set state to `Exited` instead of `Closed`
- Capture exit code from child process
- Guard `input` handler to reject when state is `Exited`
- Optional configurable auto-cleanup timeout (CLI flag or config)

### F5b: Exited Session UI (Web)

**Tests:**
1. Terminal pane shows "[exited]" or "[exited: 0]" badge when session state is `Exited`
2. Terminal input is disabled (typing does nothing) for exited sessions
3. Terminal output/scrollback is still scrollable
4. Pane border or background visually dims for exited sessions
5. Tab shows an exit indicator (icon or text)
6. Sidebar shows exit indicator on session item
7. Context menu on exited session shows "Close" but not "Detach" (session is already done)
8. Search still works on exited session scrollback

**Implementation:**
- Update `Pane.svelte` to check session state and disable input
- Add "[exited]" overlay/badge component
- CSS dimming via opacity or border color change
- Update `TabBar` and `TerminalList` to reflect exited state

---

## F6: Status Bar (Web UI)

### F6a: Status Bar Component

**Tests:**
1. Status bar renders at the bottom of the window, full width
2. Status bar shows session name of the active pane
3. Status bar shows shell type of the active pane (e.g., "zsh")
4. Status bar shows connection status: "Connected", "Reconnecting...", "Disconnected"
5. Status bar shows total active session count (e.g., "3 sessions")
6. Status bar shows current working directory if available from session metadata
7. Status bar shows session uptime / duration (e.g., "0:23:15")
8. Status bar updates when active pane changes (switching tabs or clicking a pane)
9. Status bar updates in real-time as connection status changes
10. Status bar is hidden when settings toggle `terminar.showStatusBar` is false

**Implementation:**
- New `StatusBar.svelte` component
- Subscribe to `workspaceStore` for active pane/session info
- Subscribe to connection status from `WebSocketSessionManager`
- Timer for uptime display (updates every second)
- Settings toggle in settings panel
- Place in `App.svelte` layout below the workspace

---

## F7: Key Binding Customization (Web UI)

### F7a: Key Binding Registry

**Tests:**
1. Default keybindings are loaded on startup (Ctrl-F → search, Ctrl-Shift-N → new session, etc.)
2. User keybinding overrides loaded from settings/localStorage
3. User overrides take precedence over defaults
4. `KeyBindingRegistry.match(event)` returns the bound action or null
5. Registry supports modifier combos: Ctrl, Shift, Alt/Meta, Cmd
6. Registry supports chord sequences (e.g., Ctrl-B then D) — stretch goal
7. Duplicate binding detection: warn if same key mapped to multiple actions
8. `getBindingsForAction(action)` returns all key combos for a given action (for UI display)

**Implementation:**
- New `lib/keybindings.ts` module
- `KeyBindingRegistry` class with `register()`, `match()`, `getBindingsForAction()`
- Default bindings defined as constant
- Load user overrides from settings store

### F7b: Key Binding Integration

**Tests:**
1. xterm `registerCustomKeyEventHandler` intercepts bound keys before terminal
2. Ctrl-F opens search bar (intercepted, not sent to terminal)
3. Unbound keys pass through to terminal normally
4. Ctrl-Shift-N triggers new session action
5. Keybinding for "Close Pane" (e.g., Cmd-W) triggers pane close
6. Keybinding for "Toggle Sidebar" triggers sidebar visibility
7. Keybinding for "Split Horizontal" / "Split Vertical" triggers split
8. Settings panel shows current keybindings with option to edit

**Implementation:**
- Wire `KeyBindingRegistry` into `Pane.svelte` terminal setup
- Action dispatcher mapping keybinding actions → store methods / component events
- Keybindings section in Settings panel (read-only display for v1, editable as stretch)

---

## F8: Workspace Persistence (Server API + Web)

### F8a: Workspace API (Server)

**Tests:**
1. `save_workspace` message stores workspace JSON payload on server
2. Workspace is stored per-client (keyed by a client identifier / token)
3. `load_workspace` message returns the stored workspace for the client
4. `load_workspace` returns empty/null if no workspace saved for client
5. Workspace data persists across server restarts (written to disk)
6. Workspace file is stored at `~/.terminar/workspaces/<client-id>.json`
7. Invalid workspace JSON is rejected with an error
8. Workspace payload has a max size limit (e.g., 1MB)

**Implementation:**
- New handlers for `SaveWorkspace` and `LoadWorkspace` in `handlers/`
- File-based storage in `~/.terminar/workspaces/`
- Client ID derived from auth token or session-specific identifier
- Size validation

### F8b: Auto-Save and Restore (Web UI)

**Tests:**
1. Workspace state auto-saves to localStorage on every layout change (debounced 2s)
2. Workspace state auto-saves to server on every layout change (debounced 5s)
3. On page load, workspace restored from localStorage first (fast)
4. On page load, if localStorage is empty, workspace loaded from server
5. Restored workspace re-attaches to sessions that are still alive
6. Restored workspace shows "[disconnected]" for sessions that no longer exist
7. Tab order, split layout, and pane-session assignments all persist
8. Active tab is restored correctly
9. If restore fails entirely, fall back to empty workspace (don't crash)

**Implementation:**
- Add auto-save hooks to `workspaceStore` (debounced save on mutation)
- Add `saveToServer()` and `loadFromServer()` methods to workspace store
- Restore logic on app initialization
- Graceful handling of stale session references

---

## F9: Agent Detection UI (Web)

Depends on F2 (server reports `foreground_process`).

### F9a: Agent Registry

**Tests:**
1. Built-in registry contains definitions for: Claude Code, Gemini CLI, Codex CLI, Cursor, Aider, Amazon Q, GitHub Copilot
2. `matchAgent("claude")` returns Claude Code agent definition
3. `matchAgent("node")` returns null (generic process, not an agent)
4. `matchAgent("zsh")` returns null (shell, not an agent)
5. `matchAgent("gemini")` returns Gemini CLI definition
6. `matchAgent("q")` returns Amazon Q definition
7. `matchAgent("cursor-agent")` returns Cursor definition
8. User overrides from settings are merged with built-in registry
9. User can add a custom agent definition and it matches
10. User can override a built-in agent's color or icon

**Implementation:**
- New `lib/agentRegistry.ts` module
- `AgentDefinition` interface: `{ processNames, displayName, icon, color }`
- `matchAgent(processName: string): AgentDefinition | null`
- Load user overrides from settings store and merge

### F9b: Agent Icons and Badges (Web UI)

**Tests:**
1. Tab shows agent icon when `foreground_process` matches a known agent
2. Tab reverts to default terminal icon when agent exits (foreground_process changes)
3. Pane header shows agent name badge (e.g., "Claude Code") when agent detected
4. Agent badge shows agent accent color as background
5. Sidebar session item shows agent icon
6. No icon/badge shown for unknown processes (just process name in status bar)
7. Icons update in real-time when `ForegroundChanged` notification received
8. Multiple panes can show different agent icons simultaneously

**Implementation:**
- Bundle agent icon SVGs (or use simple colored letter avatars as fallback)
- Update `TabBar.svelte` to show icon based on `agentRegistry.matchAgent()`
- Update `Pane.svelte` header to show agent name badge
- Update `TerminalList.svelte` in sidebar
- Subscribe to `ForegroundChanged` messages in session manager

---

## F10: Synchronized Input / Broadcast Mode (Web UI)

### F10a: Broadcast Store

**Tests:**
1. `broadcastStore` tracks set of target session IDs
2. `addTarget(sessionId)` adds a session to broadcast targets
3. `removeTarget(sessionId)` removes a session from broadcast targets
4. `toggleTarget(sessionId)` toggles inclusion
5. `clearTargets()` removes all targets
6. `isTarget(sessionId)` returns boolean
7. `broadcastInput(data)` sends `input` message to ALL target sessions
8. Broadcast store persists targets across broadcast bar open/close
9. Targets are cleared when broadcast mode is fully disabled

**Implementation:**
- New `lib/broadcastStore.ts` Svelte store
- Methods: `addTarget`, `removeTarget`, `toggleTarget`, `clearTargets`, `broadcastInput`
- Uses existing `WebSocketSessionManager.sendInput()` for each target

### F10b: Broadcast UI

**Tests:**
1. Broadcast icon in toolbar (next to shortcuts/settings) toggles broadcast mode
2. Broadcast icon shows active state (highlighted) when broadcast mode is on
3. Clicking broadcast icon opens broadcast input bar at bottom of screen (above status bar)
4. Broadcast input bar has text input field and "Send" button
5. Enter in broadcast input bar sends input + newline to all target sessions
6. Sidebar shows checkboxes next to sessions when broadcast mode is active
7. Checking/unchecking sidebar checkboxes updates broadcast targets
8. Visual indicator (colored border) on panes that are broadcast targets
9. Broadcast input bar shows count of targets (e.g., "Broadcasting to 3 sessions")
10. Closing broadcast bar does not clear targets (toggling back shows same selection)
11. Escape closes broadcast bar

**Implementation:**
- New `BroadcastBar.svelte` component
- New `BroadcastIcon` in toolbar
- Checkbox column in `TerminalList.svelte` when broadcast mode active
- Border highlight on `Pane.svelte` for target sessions
- Wire input to `broadcastStore.broadcastInput()`

---

## F11: Environment Variable Management (Web UI + Protocol)

### F11a: Environment Variable Store

**Tests:**
1. `envStore` tracks global env vars (applied to all new sessions)
2. `envStore` tracks per-session env vars (override globals)
3. `getEffectiveEnv(sessionOverrides)` merges global + per-session with session precedence
4. Global env vars persist to localStorage
5. Global env vars persist to server (via settings API)
6. Per-session env vars are sent in `create_session` message
7. Empty env var values are allowed (set var to empty string)
8. Deleting an env var removes it from the store
9. Reserved env var names (LD_PRELOAD, etc.) are filtered by the server (existing behavior)

**Implementation:**
- New `lib/envStore.ts` Svelte store
- `globalEnvVars` writable store persisted to localStorage + settings API
- `getEffectiveEnv()` function for merge logic
- Integration with session creation flow

### F11b: Environment Variable UI

**Tests:**
1. Settings panel has "Environment Variables" section
2. Global env vars displayed as key-value rows with add/remove buttons
3. Adding a row creates empty key-value pair, editable inline
4. Removing a row deletes the env var
5. Changes auto-save (debounced)
6. "New Session" dialog has expandable "Environment Variables" section
7. Per-session env vars shown as key-value editor in session creation
8. Per-session env vars visually distinguished from globals (e.g., "overrides global" hint)
9. Validation: key must be non-empty, no spaces in key, no `=` in key

**Implementation:**
- New `EnvVarEditor.svelte` component (reusable key-value editor)
- Add to Settings panel for global env vars
- Add to session creation dialog for per-session env vars
- Validation logic for env var names

---

## Implementation Order

### Phase 1: Foundation
1. **F1a** Protocol schema updates (shell-protocol)
2. **F1b** Rust message types

### Phase 2: Server Features (parallel)
3. **F2a** Foreground process resolution
4. **F2b** Foreground polling task
5. **F3a** Activity tracking
6. **F5a** Exited session state
7. **F8a** Workspace API

### Phase 3: Web UI — Independent Features (parallel)
8. **F4a** Search bar component
9. **F4b** Search addon integration
10. **F6a** Status bar component
11. **F7a** Key binding registry
12. **F7b** Key binding integration
13. **F10a** Broadcast store
14. **F10b** Broadcast UI
15. **F11a** Environment variable store
16. **F11b** Environment variable UI

### Phase 4: Web UI — Depends on Server (parallel, after Phase 2)
17. **F3b** Activity indicators
18. **F5b** Exited session UI
19. **F8b** Auto-save and restore
20. **F9a** Agent registry
21. **F9b** Agent icons and badges

### Total: 21 tasks, ~130 test cases
