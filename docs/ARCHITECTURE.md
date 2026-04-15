# terminar Architecture Reference

> This document is the authoritative reference for the terminar codebase architecture.
> Keep it updated when adding new modules, binaries, or major features.

## System Overview

terminar provides persistent terminal sessions across an Electron tray app, VS Code, and a dev-only web frontend. It runs locally only — the server listens on a Unix socket and localhost HTTP.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Frontends                         │
│                                                                 │
│  Electron Tray (shipped)   VS Code Extension   Web (dev-only)   │
│   WebSocket (localhost)     Unix socket         WebSocket        │
└──────────────┬──────────────────┬──────────────────┬────────────┘
               │                  │                  │
               ▼                  ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                     terminar-server (local)                      │
│  Unix socket (:sock) + HTTP/WebSocket (localhost:6749)           │
│  PTY management, session persistence, output history             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Rust Server (`server/`)

### Binary

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `terminar-server` | `src/main.rs` | Local PTY server |

### Module Map

| Module | Purpose |
|--------|---------|
| `main.rs` | CLI parsing, socket path, starts server |
| `lib.rs` | HTTP/WebSocket routing, message dispatch |
| `config.rs` | `Cli` struct (clap) for terminar-server args |
| `messages.rs` | Client/Server message types (serde) |
| **`handlers/`** | |
| `handlers/mod.rs` | Handler dispatch |
| `handlers/session.rs` | Create, list, kill, rename sessions; PTY spawning |
| `handlers/io.rs` | Input (write to PTY), Resize, Attach (output forwarding) |
| `handlers/workspace.rs` | Save/load workspace layout (JSON persistence) |
| **Core** | |
| `connection.rs` | Client connection tracking |
| `workspace.rs` | Workspace state persistence |
| `settings.rs` | Per-session settings (theme, env vars) |
| `audit.rs` | Event logging to disk |
| `constants.rs` | Defaults (ports, timeouts, limits) |
| `error.rs` | Error types |
| `logging.rs` | Tracing config (JSON, file, env filter) |

### Key CLI Flags

**terminar-server:**
```
--port <PORT>           HTTP/WS port (default: 6749)
--socket <PATH>         Unix socket path (default: /tmp/vscode-terminar-<uid>.sock)
--no-auth               Disable auth (dev only)
--persist-sessions      Save sessions to disk
--persist-history       Save terminal output history
--compress-history      zstd compression for history >1MB
```

### Tech Stack

Tokio, Axum, portable-pty, serde/serde_json, zstd, tracing

---

## Electron Tray (`tray/`)

Electron app — runs as a menu bar icon (macOS) or system tray (Linux/Windows). Tray-only (no Dock icon on macOS). This is the shipped desktop frontend that bundles the server binary.

### Electron Main Process (`tray/src/main/`)

| Module | Purpose |
|--------|---------|
| `index.ts` | App lifecycle, orchestration, single instance lock |
| `TrayManager.ts` | System tray icon + dynamic context menu from health/config state |
| `HealthPoller.ts` | Polls server `/health` endpoint every 5s via `fetch()` |
| `ConfigStore.ts` | `TrayConfig` persistence (`~/.terminar/tray-config.json`) |
| `WindowManager.ts` | Settings/terminal window lifecycle |
| `WebUIManager.ts` | Embedded web UI management |
| `SocketBridge.ts` | Socket bridge for extension communication |
| `MultiWindowCoordinator.ts` | Coordinate multiple window instances |
| `WslManager.ts` | WSL integration (Windows) |
| `ipc.ts` | IPC handler registration (main <-> renderer) |
| `menuSpec.ts` | Pure function `computeMenuSpec()` for tray menu (unit-testable) |
| `paths.ts` | App root path resolution (`getAppRoot()`) |
| `types.ts` | Shared TypeScript types and defaults |

### Svelte Frontend (`tray/src/renderer/`)

| Component | Purpose |
|-----------|---------|
| `App.svelte` | Routes between views |
| `Settings.svelte` | Configuration UI |
| `TerminalApp.svelte` | Embedded terminal view |

### Tray Menu Items

- Server status (green/yellow/red indicator)
- Open Web UI (launches browser)
- Start/Stop/Restart Server
- Settings window
- Quit

### Tech Stack

Electron, Svelte 5, Vite, Playwright (E2E), Vitest (unit)

---

## Web Frontend (`web/`) — Dev-Only

Used during development for rapid UI iteration. Not shipped in the distributed app.

### Component Hierarchy

```
App.svelte                      # Root: connection, auth, session management
├── AppToolbar.svelte            # Top bar: broadcast, shortcuts help
├── Sidebar.svelte               # Right panel: session list
│   └── TerminalList.svelte      # Session items with drag source
│       └── TerminalListItem.svelte  # Individual session (name, process, pane count)
├── WorkspaceView.svelte         # Multi-pane layout + context menus + keyboard shortcuts
│   ├── TabBar.svelte            # Tab management
│   └── SplitContainer.svelte    # Recursive split layout
│       └── Pane.svelte          # Terminal pane wrapper
│           └── Terminal.svelte  # xterm.js instance (write buffering, auto-scroll)
├── SettingsPanel.svelte         # Settings UI
├── SearchBar.svelte             # Terminal search
├── BroadcastBar.svelte          # Broadcast input to multiple sessions
├── StatusBar.svelte             # Bottom status bar
├── ContextMenu.svelte           # Right-click menus with submenus
├── ThemeEditor.svelte           # Theme customization
└── EnvVarEditor.svelte          # Environment variable editor
```

### Key Stores (`web/src/lib/`)

| Store/Module | Purpose |
|--------------|---------|
| `workspaceStore.ts` | Split pane tree, tabs, pane-session mapping. Persists to server. |
| `sessionContext.ts` | Svelte context: manager, sessions, actions (avoids prop drilling) |
| `settingsStore.ts` | User settings with server sync |
| `themeStore.ts` | UI theme (light/dark/auto) + terminal theme |
| `foregroundStore.ts` | Foreground process per session |
| `titleStore.ts` | Terminal title per session |
| `activityStore.ts` | Bell/activity/silence indicators |
| `keybindings.ts` | Keybinding registry (Cmd+B sidebar, Cmd+Shift+E split, etc.) |
| `keyEventHandler.ts` | xterm custom key handler factory |
| `actionDispatcher.ts` | Maps keybinding actions to callbacks |
| `searchStore.ts` | Search state |
| `broadcastStore.ts` | Broadcast mode targets |
| `envStore.ts` | Environment variables |
| `paneRegistry.ts` | Track mounted pane instances for parent access |
| `workspaceTypes.ts` | Pane/Tab/Workspace types + tree helpers |

### Workspace Model

```typescript
Workspace { tabs: Tab[], activeTabId }
  └── Tab { id, name, root: SplitNode }
        └── SplitNode = Pane | SplitContainer
              Pane { id, sessionId: string | null }
              SplitContainer { direction, children: SplitNode[], ratios }
```

### Tech Stack

Svelte 5, Vite, xterm.js, Vitest, TypeScript

---

## Protocol Package (`packages/shell-protocol/`)

Shared TypeScript package used by both web frontend and VS Code extension.

### Exports

| Export | Purpose |
|--------|---------|
| `ClientMessage` / `ServerMessage` | Zod schemas for all wire messages |
| `ShellClient` | High-level client: auth, list, create, attach, input, resize |
| `IShellSocket` | Transport interface (Unix socket or WebSocket) |
| `BaseWebSocketManager` | Shared WebSocket lifecycle (connect, reconnect, message routing) |
| `parseServerMessage()` | Safe message parsing with Zod validation |

### Protocol Version

Current: `0.2.0` (sent in auth handshake)

---

## VS Code Extension (`extension/`)

| File | Purpose |
|------|---------|
| `extension.ts` | Entry point, command registration (`TerminarExtension` class) |
| `ServerController.ts` | Spawns/monitors terminar-server process |
| `SessionManager.ts` | Session CRUD via `ShellClient` |
| `SessionTreeProvider.ts` | Sidebar tree view |
| `NetSocketAdapter.ts` | Unix socket with 4-byte big-endian length-prefixed JSON |
| `WebSocketAdapter.ts` | WebSocket transport for remote servers |
| `settings.ts` | VS Code config bindings |

Tests: Mocha (not Vitest), mock `vscode` module via `setup.js`

---

## Authentication

| Client | Flow |
|--------|------|
| **VS Code** | Server writes token to `~/.terminar/token` -> extension reads it automatically |
| **Tray App** | HTTP polling to `/health` endpoint (no session auth needed) |
| **Web (dev)** | Connects to localhost server with token auth |

---

## Message Flow

```
Client ──[ClientMessage JSON]──→ Transport ──→ Server message dispatch
                                                    │
                                              Handler (session/io/workspace)
                                                    │
Server ──[ServerMessage JSON]──→ Transport ──→ Client
```

Transports:
- Unix socket: 4-byte big-endian length prefix + JSON body
- WebSocket: JSON text frames

---

## Important Patterns & Gotchas

### Auto-Scroll Listener (Terminal.svelte) — DO NOT MODIFY
The scroll listener in `initAutoScroll()` must remain simple: `if (isAtBottom()) set(true) else set(false)`. No `isOutputActive` guards. Has been broken 3+ times.

### Write Buffering (Terminal.svelte)
Chunks writes at 128KB max per `term.write()` call with watermark-based flow control. Caps buffer at 2MB. Prevents freezes during heavy output.

### Svelte Reactivity in Event Listeners
Variables modified in `addEventListener` callbacks don't trigger re-renders. Use `writable()` stores for any state that drives `{#if}` blocks from listeners/callbacks.

### Svelte Context + Testing
`@testing-library/svelte` doesn't support context injection. Use `hasContext()` fallbacks and optional prop overrides. Create wrapper components for tests needing full context.

### Protocol Package Build Order
Must run `pnpm build` in `packages/shell-protocol/` before extension tests. Extension imports from `dist/`. The package has a `tsc --noUnusedLocals` check — remove unused imports.

### Dual Keyboard Handler
Both `App.svelte` (global `handleGlobalKeydown`) and terminal panes (xterm custom key handler) match keybindings. Global handler skips `event.defaultPrevented` to avoid double-toggling.

### Environment
`cargo` is at `~/.cargo/bin/cargo` — may need to prepend to PATH.
