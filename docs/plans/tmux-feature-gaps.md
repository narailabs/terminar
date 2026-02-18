# terminar vs tmux — Feature Gap Analysis

## Status: Decisions Made

This document catalogs features tmux has that terminar lacks, with decisions on each.

---

## Decision Summary

| # | Feature | Decision | Version | Notes |
|---|---------|----------|---------|-------|
| 1 | Server-side windows | **Skip** | — | Keep PTY as the server unit. Tabs/organization stay client-side but must be **persisted** per client. |
| 2 | Server-side pane splitting | **Skip** | — | Keep splits client-side but must **persist client layout** across reconnects. |
| 3 | Synchronized input | **Implement** | v1 | Broadcast icon in toolbar opens an input bar. Terminal selection via checkboxes. |
| 4 | Scripting / command API | **Defer** | v2 | CLI tool + send-keys, capture-output, pipe-output protocol messages. |
| 5 | Copy / paste / search | **Client-side** | v1 | Full OS clipboard support on client. Client-side search-in-scrollback (Ctrl-F). No server-side copy mode. |
| 6 | Activity monitoring | **Implement** | v1 | Server tracks activity/silence per session. Push to clients. Visual indicators. |
| 7 | Key binding customization | **Client-side** | v1 | Leverage xterm.js `registerCustomKeyEventHandler`. Config in client settings. |
| 8 | Hooks / event system | **Defer** | v2 | Protocol event subscriptions + config-file shell command hooks. |
| 9 | Status bar | **Implement** | v1 | Client-rendered status bar with session info, connection status, active session count. |
| 10 | Preset layouts | **Defer** | v2 | Client-side layout presets (tiled, main+sidebar, etc.) with save/restore. |
| 11 | Remain-on-exit | **Implement** | v1 | Keep terminal visible (read-only) after shell exits. User inspects output before closing. |
| 12 | Session groups | **Skip** | — | Already covered — client-side tabs mean each client independently selects sessions. |
| 13 | Lock screen | **Skip** | — | OS-level screen lock handles idle security. Auth on connect is sufficient. |
| 14 | Detach command | **Already implemented** | — | Close button popup has "Detach" (remove from pane) and "Terminate" (kill session). |
| 15 | Environment management | **Implement** | v1 | Per-session AND global env vars. Client-side settings with per-session precedence over global defaults. |

---

## v1 Roadmap Items (Implement Now)

### 3. Synchronized Input (Broadcast Mode)

**UI Design:**
- Broadcast icon in the toolbar (next to shortcuts and settings icons)
- Clicking the icon opens a **broadcast input bar** at the top/bottom of the screen
- Terminals are selected as broadcast targets via checkboxes in the sidebar
- Visual indicator on targeted terminals (e.g., colored border or icon overlay)
- Input typed in the broadcast bar is sent to all selected terminals simultaneously

**Use cases:** Multi-server ops, dev environment setup, teaching/demos.

**Implementation:** Client-side feature — the broadcast bar sends the same `input` message to multiple session IDs via the existing protocol. No server changes needed.

---

### 5. Copy / Paste / Search (Client-Side)

**Decision:** Keep all clipboard and search functionality on the client side.

- **Copy/paste:** Full OS clipboard integration via xterm.js clipboard API and browser Clipboard API
- **Search-in-scrollback:** Client-side Ctrl-F search through the xterm.js buffer using the [xterm-addon-search](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-search) addon
- **No server-side copy mode** — browser/OS handles selection, clipboard, and search natively

**Rationale:** Server-side copy mode adds substantial complexity (frozen output, vi/emacs key handling, paste buffers) with minimal benefit when clients already have native clipboard and search capabilities.

---

### 6. Activity Monitoring

**Server-side:**
- Track last output timestamp per session
- Track bell character events
- Configurable silence threshold (e.g., "alert if no output for N seconds")
- New protocol notification messages: `session_activity`, `session_bell`, `session_silence`

**Client-side:**
- Visual indicators on tabs/sidebar (dot badge, color change)
- Optional system notifications (browser Notification API / VS Code notification)
- Per-session toggle for monitoring

---

### 7. Key Binding Customization (Client-Side)

**Approach:** Leverage xterm.js `registerCustomKeyEventHandler` API.

- Configurable in client settings (web UI settings panel / VS Code settings)
- Map keyboard shortcuts to terminar actions: new session, switch tab, split, close pane, toggle sidebar, etc.
- Default keybindings provided, user can override
- No server-side key table system — all handled at the client level

---

### 9. Status Bar

**Client-rendered status bar** at the bottom of the web UI (and optionally VS Code):

- Session name and shell type
- Connection status (connected / reconnecting / disconnected)
- Active sessions count
- Current working directory (if available from session metadata)
- Uptime or session duration
- Customizable sections (stretch goal)

---

### 11. Remain-on-Exit

**Behavior:**
- When a shell process exits, the terminal stays visible in **read-only mode**
- Final output is preserved and scrollable
- Visual indicator that the session has exited (e.g., dimmed border, "[exited]" badge)
- User can manually close/detach when done inspecting

**Server-side:** New session state `Exited` (distinct from `Closed`). Session stays in memory with history buffer intact. Optional auto-cleanup after configurable timeout.

**Client-side:** Detect `Exited` state, disable input, show exit indicator.

---

### 15. Environment Variable Management

**Two tiers with precedence:**

1. **Global env vars** — applied to ALL new sessions (e.g., `EDITOR=vim`, `LANG=en_US.UTF-8`)
2. **Per-session env vars** — override globals for a specific session

**Per-session takes precedence over global.**

**Storage:** Client-side settings (localStorage for web, VS Code settings for extension). Sent as part of `create_session` message.

**UI:**
- Global env vars section in Settings panel
- Per-session env vars in session creation dialog (and editable in session properties)
- Key-value editor with add/remove rows

**Note:** This is for env vars set at session creation time. Dynamic env var injection into running sessions is a v2 feature (requires server-side support).

---

## v2 Roadmap Items (Deferred)

### 4. Scripting / Command API

Full CLI tool (`terminar`) that talks to the running server:
- `terminar send-keys <session> 'command' Enter`
- `terminar capture <session> --lines -100`
- `terminar pipe <session> 'cat >> log.txt'`
- `terminar list` / `terminar info <session>`

New protocol messages: `send_keys`, `capture_output`, `pipe_output`.

### 8. Hooks / Event System

Protocol event subscriptions:
- `subscribe { events: ["session.created", "session.closed", "output.activity"] }`
- Server pushes notifications to subscribed clients

Config-file hooks:
- `terminar hook add session.created 'notify-send "New session"'`

### 10. Preset Layouts

Client-side layout presets:
- Built-in: tiled, main+sidebar, even-horizontal, even-vertical
- Save/restore custom layouts by name
- Toolbar button or keyboard shortcut to apply/cycle presets

---

## Architectural Notes

### Client-Side Persistence (Items 1 & 2)

Since windows (tabs) and pane splits remain client-side, we need robust client state persistence:

- **Web UI:** Workspace state (tab arrangement, split layout, which sessions are in which panes) saved to localStorage AND optionally to the server via the settings/workspace API
- **VS Code:** Workspace state saved via VS Code's `workspaceState` API
- **On reconnect:** Client restores its layout and re-attaches to sessions

This is partially implemented today (workspace store saves to localStorage). Gaps:
- Server-side workspace save for cross-device persistence
- VS Code extension has no workspace persistence

### Server's Role

The server remains focused on **PTY management**: session lifecycle, I/O, auth, history, and activity tracking. Layout, tabs, and visual organization are client concerns. This is an intentional architectural divergence from tmux's server-owns-everything model — it plays to terminar's strengths as a multi-client, multi-frontend system.

---

## tmux Reference (Detailed Research)

The detailed research for each feature is preserved below for future reference.

<details>
<summary>1. Server-Side Windows Model (tmux reference)</summary>

A tmux **session** contains one or more **windows**. Each window is a full-screen container that holds one or more panes. Windows are the equivalent of "tabs" — only one is visible at a time per client, but all run simultaneously.

**Key mechanics:**
- Windows get persistent IDs (prefixed `@`, e.g. `@0`, `@1`) that never change
- Windows are **linked** into sessions, not owned — a single window can appear in multiple sessions via `link-window`
- Each window tracks: its layout, pane arrangement, active pane pointer, window options, name, and size
- Navigation: by index (`C-b 0-9`), next/previous (`C-b n/p`), last (`C-b l`), or by name
- Windows can be moved (`move-window`), swapped (`swap-window`), reordered, and auto-renumbered (`renumber-windows`)

**Window referencing syntax:**
```
session:0        # by index
session:@5       # by persistent ID
session:mywindow # by name
session:my*      # by glob pattern
```
</details>

<details>
<summary>2. Server-Side Pane Splitting (tmux reference)</summary>

Panes are PTYs arranged within a window. The **server** manages the layout.

**Per-pane state tracked by server:**
- PTY file descriptor and terminal state
- Process ID of running command
- Scroll history buffer (configurable via `history-limit`)
- Cursor position and visual attributes
- Pane title, options, active/inactive state
- Persistent ID (prefixed `%`, e.g. `%0`, `%1`)

**Layout strings** serialize the arrangement:
```
bb62,159x48,0,0{79x48,0,0,79x48,80,0}
```

**Key operations:**
- `split-window` — divides current pane
- `resize-pane` — grow/shrink by N cells
- `zoom` (`C-b z`) — expand one pane to full window
- `break-pane` — detach pane into new window
- `join-pane` — move pane from another window into current
- `swap-pane` — exchange two panes' positions
</details>

<details>
<summary>4. Scripting / Command API (tmux reference)</summary>

**`send-keys`** — inject keystrokes into any pane:
```bash
tmux send-keys -t mysession:0.1 'ls -la' Enter
tmux send-keys -t %5 C-c
tmux send-keys -l 'literal text'
```

**`capture-pane`** — extract pane contents:
```bash
tmux capture-pane -t %0 -p                   # print to stdout
tmux capture-pane -t %0 -S -100 -E -1 -p    # last 100 lines
tmux capture-pane -t %0 -e -p               # include ANSI escapes
```

**`pipe-pane`** — stream pane I/O:
```bash
tmux pipe-pane -t %0 'cat >> ~/session.log'
tmux pipe-pane -I -t %0 'echo hello'
```

**`run-shell`**, **`wait-for`**, **`display-message`** — scripting primitives.
</details>

<details>
<summary>5. Copy Mode (tmux reference)</summary>

Copy mode **freezes the pane output** for scrolling, searching, and selecting.

**Two key binding tables:** `copy-mode` (emacs) and `copy-mode-vi` (vi).

**Search:** regex, literal, incremental, repeat.

**Selection:** line or rectangle select. Copy to paste buffer stack (50 max). `copy-pipe` sends to shell command.

**Paste buffers:** Stack-based. Named buffers persist. `set-buffer`, `load-buffer`, `save-buffer` for programmatic access.
</details>

<details>
<summary>8. Hooks / Event System (tmux reference)</summary>

```bash
tmux set-hook -g after-new-session 'display-message "New session"'
```

**Events:** `session-created`, `window-linked`, `pane-created`, `pane-exited`, `pane-focus-in/out`, `client-attached/detached`, `alert-activity/bell/silence`, `after-select-window/pane`, `after-send-keys`, `after-copy-mode`, and more.

**Scoping:** `-g` for global, otherwise session-specific. Multiple hooks per event.
</details>

<details>
<summary>10. Preset Layouts (tmux reference)</summary>

**7 built-in presets:** even-horizontal, even-vertical, main-horizontal, main-horizontal-mirrored, main-vertical, main-vertical-mirrored, tiled.

**Custom layouts** via serialized strings: `bb62,159x48,0,0{79x48,0,0,79x48,80,0}`

**Operations:** `select-layout`, `next-layout`, undo (`-o`), spread (`-E`).
</details>
