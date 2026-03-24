# terminar Architecture Reference

> This document is the authoritative reference for the terminar codebase architecture.
> Keep it updated when adding new modules, binaries, or major features.

## System Overview

terminar provides persistent terminal sessions across VS Code, browsers, and desktop apps. It has two deployment modes:

1. **Single-user** — `terminar-server` runs locally, connects via Unix socket (VS Code) or WebSocket (browser)
2. **Multi-user** — `terminar-gateway` runs on a shared server, authenticates users, spawns per-user `terminar-server` instances via `sudo`

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Frontends                         │
│                                                                 │
│  VS Code Extension    Web (Svelte)   Tray (Electron)   Electron  │
│   Unix socket         WebSocket       HTTP health      WebSocket │
└──────┬─────────────────┬──────────────────┬──────────────┬──────┘
       │                 │                  │              │
       ▼                 ▼                  ▼              ▼
┌──────────────────────────────────────────────────────────────────┐
│                     terminar-server (single-user)                │
│  Unix socket (:sock) + HTTP/WebSocket (:6749)                    │
│  PTY management, session persistence, output history             │
└──────────────────────────────────────────────────────────────────┘

       OR (multi-user deployment):

┌──────────────────────────────────────────────────────────────────┐
│                     terminar-gateway                             │
│  TLS termination (:8444), HTTP (:6749)                           │
│  Auth (password/SSH key → JWT), per-user server spawning         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │  sudo -u alice terminar-server --user-mode             │      │
│  │  /run/terminar/alice.sock                              │      │
│  ├────────────────────────────────────────────────────────┤      │
│  │  sudo -u bob terminar-server --user-mode               │      │
│  │  /run/terminar/bob.sock                                │      │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Rust Server (`server/`)

### Binaries

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `terminar-server` | `src/main.rs` | Single-user PTY server |
| `terminar-gateway` | `src/bin/gateway.rs` | Multi-user reverse proxy |

### Module Map

| Module | Purpose |
|--------|---------|
| `main.rs` | CLI parsing, socket path, starts server |
| `lib.rs` | HTTP/WebSocket routing, message dispatch (~2000 lines + tests) |
| `config.rs` | `Cli` struct (clap) for terminar-server args |
| `messages.rs` | Client/Server message types (serde) |
| **`handlers/`** | |
| `handlers/auth.rs` | Token exchange, version negotiation |
| `handlers/session.rs` | Create, list, kill, rename sessions; PTY spawning |
| `handlers/io.rs` | Input (write to PTY), Resize, Attach (output forwarding) |
| `handlers/workspace.rs` | Save/load workspace layout (JSON persistence) |
| **`gateway/`** | |
| `gateway/mod.rs` | Gateway main: state, routing, health endpoint |
| `gateway/config.rs` | `GatewayConfig` (clap) for gateway args |
| `gateway/proxy.rs` | WebSocket proxy: gateway → per-user server |
| `gateway/user_server.rs` | Spawn/track/reap per-user server processes |
| **Security** | |
| `auth.rs` | PAM login, password verification, SSH key auth |
| `jwt.rs` | JWT signing/verification, key management |
| `cookies.rs` | HttpOnly cookie auth for browsers |
| `revocation.rs` | Token blacklist |
| `tls.rs` | TLS setup, self-signed cert generation, cert reload |
| `security_headers.rs` | HSTS, CSP, etc. |
| `audit.rs` | Security event logging to disk |
| **Core** | |
| `session.rs` | Session state machine, PTY lifecycle |
| `pty.rs` | PTY spawning via `portable-pty` |
| `connection.rs` | Client connection tracking |
| `persistence.rs` | Session state → JSON file |
| `history.rs` | Output history ring buffer, zstd compression |
| `process.rs` | Process tree, foreground process detection |
| `settings.rs` | Per-session settings (theme, env vars) |
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
--tls-cert/--tls-key    TLS certificate and key paths
--user-mode             Run as per-user server (spawned by gateway)
pair                    Subcommand: generate pairing code for browser auth
```

**terminar-gateway:**
```
--port <PORT>           HTTP port (default: 6749)
--tls-port <PORT>       TLS port (default: 8444)
--server-bin <PATH>     Path to terminar-server binary
--socket-dir <PATH>     Per-user socket directory (default: /run/terminar)
--idle-timeout <SECS>   Shutdown idle servers (default: 1800)
--auto-tls              Auto-generate self-signed cert (default: true)
```

### Tech Stack

Tokio, Axum, portable-pty, serde/serde_json, jsonwebtoken, rustls, zstd, ring, tracing

---

## Web Frontend (`web/`)

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
├── LoginPage.svelte             # Password/SSH key/pairing code auth
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

## System Tray (`tray/`)

Electron app — runs as a menu bar icon (macOS) or system tray (Linux/Windows). Tray-only (no Dock icon on macOS).

### Electron Main Process (`tray/src/main/`)

| Module | Purpose |
|--------|---------|
| `index.ts` | App lifecycle, orchestration, single instance lock |
| `TrayManager.ts` | System tray icon + dynamic context menu from health/config state |
| `HealthPoller.ts` | Polls gateway `/health` endpoint every 5s via `fetch()` |
| `ServiceManager.ts` | launchd/systemd service management (bash script generation) |
| `ConfigStore.ts` | `TrayConfig` persistence (`~/.terminar/tray-config.json`) |
| `WindowManager.ts` | Install/Settings window lifecycle |
| `elevation.ts` | Elevated script execution via `osascript` (macOS) / `pkexec` (Linux) |
| `ipc.ts` | IPC handler registration (main ↔ renderer) |
| `types.ts` | Shared TypeScript types and defaults |

### Svelte Frontend (`tray/src/renderer/`)

| Component | Purpose |
|-----------|---------|
| `App.svelte` | Routes between Install and Settings views |
| `Install.svelte` | First-run wizard (install gateway service) |
| `Settings.svelte` | Configure port, TLS, auth, audit level |
| `lib/api.ts` | Typed wrapper around `window.trayAPI` (preload bridge) |

### Tray Menu Items

- Server status (green/yellow/red indicator)
- Open Web UI (launches browser)
- Toggle TLS / Toggle Auth
- Audit Level submenu
- Start/Stop/Restart Service
- Install/Uninstall Gateway
- Settings window
- Quit

### Tech Stack

Electron, Svelte 5, Vite, Playwright (E2E), Vitest (unit)

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

## Electron (`electron/`) — Experimental (Inactive)

Scaffolded desktop wrapper experiment. Not the primary desktop path — the Electron tray app (`tray/`) is the active desktop component.

Contains: `WindowManager`, `ServerManager`, `TrayManager`, `MenuManager`, `ShortcutManager`, `AutoUpdater`, `ConfigStore`, IPC handlers.

---

## Deployment (`deploy/`)

| File | Purpose |
|------|---------|
| `terminar-server.service` | Systemd unit for single-user server |
| `terminar-gateway.service` | Systemd unit for multi-user gateway |
| `com.terminar.gateway.plist` | macOS launchd plist for gateway |
| `terminar-sudoers` | sudoers fragment: gateway can spawn per-user servers |
| `postinst.sh` | Debian post-install script |
| `logrotate.d/` | Log rotation for server + audit logs |

### Gateway Deployment Model

1. Gateway runs as `terminar` system user
2. Spawns per-user servers via `sudo -u <username> terminar-server --user-mode`
3. Each user's server listens on `/run/terminar/<username>.sock`
4. Gateway proxies authenticated WebSocket → per-user socket
5. Idle servers shut down after 30 min (configurable)

---

## Authentication Flows

| Client | Flow |
|--------|------|
| **VS Code** | Server writes token to `~/.terminar/token` → extension reads it automatically |
| **Browser (single-user)** | `terminar-server pair` generates 8-digit code → browser enters code → gets token |
| **Browser (multi-user)** | Browser connects to gateway TLS → password/SSH key auth → JWT |
| **Tray App** | HTTP polling to `/health` endpoint (no session auth needed) |

---

## Message Flow

```
Client ──[ClientMessage JSON]──→ Transport ──→ Server message dispatch
                                                    │
                                              Handler (auth/session/io/workspace)
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
