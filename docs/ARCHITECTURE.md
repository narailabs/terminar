# terminar Architecture Reference

> This document is the authoritative reference for the terminar codebase architecture.
> Keep it updated when adding new modules, binaries, or major features.

## System Overview

terminar provides persistent terminal sessions across VS Code and the Electron desktop app. The server runs locally in single-user mode, communicating via Unix socket.

> **Note:** Multi-user gateway (`terminar-gateway`) and web frontend are deferred to v2.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Frontends                         │
│                                                                 │
│  VS Code Extension          Electron App (tray/)                │
│   Unix socket                Unix socket                        │
└──────┬──────────────────────────┬───────────────────────────────┘
       │                          │
       ▼                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                     terminar-server (single-user)                │
│  Unix socket only                                                │
│  PTY management, session persistence, output history             │
└──────────────────────────────────────────────────────────────────┘
```

---

## Rust Server (`server/`)

### Binaries

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `terminar-server` | `src/main.rs` | Single-user PTY server |

### Module Map

| Module | Purpose |
|--------|---------|
| `main.rs` | CLI parsing, socket path, starts server |
| `lib.rs` | Message dispatch, routing (~2000 lines + tests) |
| `config.rs` | `Cli` struct (clap) for terminar-server args |
| `messages.rs` | Client/Server message types (serde) |
| **`handlers/`** | |
| `handlers/auth.rs` | Token exchange, version negotiation |
| `handlers/session.rs` | Create, list, kill, rename sessions; PTY spawning |
| `handlers/io.rs` | Input (write to PTY), Resize, Attach (output forwarding) |
| `handlers/workspace.rs` | Save/load workspace layout (JSON persistence) |
| **Security** | |
| `auth.rs` | Token-based auth |
| **Core** | |
| `session.rs` | Session state machine, PTY lifecycle |
| `pty.rs` | PTY spawning via `portable-pty` |
| `connection.rs` | Client connection tracking |
| `persistence.rs` | Session state → JSON file |
| `history.rs` | Output history ring buffer, zstd compression |
| `process.rs` | Process tree, foreground process detection |
| `settings.rs` | Per-session settings (theme, env vars) |
| `constants.rs` | Defaults (timeouts, limits) |
| `error.rs` | Error types |
| `logging.rs` | Tracing config (JSON, file, env filter) |

### Key CLI Flags

**terminar-server:**
```
--socket <PATH>         Unix socket path (default: /tmp/vscode-terminar-<uid>.sock)
--no-auth               Disable auth (dev only)
--persist-sessions      Save sessions to disk
--persist-history       Save terminal output history
--compress-history      zstd compression for history >1MB
```

### Tech Stack

Tokio, Axum, portable-pty, serde/serde_json, zstd, tracing

---

## Electron App (`tray/`)

Electron app — runs as a menu bar icon (macOS) or system tray (Linux/Windows). Includes integrated terminal UI with xterm.js.

### Electron Main Process (`tray/src/main/`)

| Module | Purpose |
|--------|---------|
| `index.ts` | App lifecycle, orchestration, single instance lock |
| `TrayManager.ts` | System tray icon + dynamic context menu from health/config state |
| `HealthPoller.ts` | Polls server health endpoint |
| `ServiceManager.ts` | launchd/systemd service management (bash script generation) |
| `ConfigStore.ts` | `TrayConfig` persistence (`~/.terminar/tray-config.json`) |
| `WindowManager.ts` | Install/Settings/Terminal window lifecycle |
| `elevation.ts` | Elevated script execution via `osascript` (macOS) / `pkexec` (Linux) |
| `ipc.ts` | IPC handler registration (main ↔ renderer) |
| `types.ts` | Shared TypeScript types and defaults |

### Svelte Frontend (`tray/src/renderer/`)

| Component | Purpose |
|-----------|---------|
| `App.svelte` | Routes between Install, Settings, and Terminal views |
| `Install.svelte` | First-run wizard (install service) |
| `Settings.svelte` | Configure settings |
| `lib/api.ts` | Typed wrapper around `window.trayAPI` (preload bridge) |

### Tech Stack

Electron, Svelte 5, xterm.js, Vite, Playwright (E2E), Vitest (unit)

---

## Protocol Package (`packages/shell-protocol/`)

Shared TypeScript package used by Electron app and VS Code extension.

### Exports

| Export | Purpose |
|--------|---------|
| `ClientMessage` / `ServerMessage` | Zod schemas for all wire messages |
| `ShellClient` | High-level client: auth, list, create, attach, input, resize |
| `IShellSocket` | Transport interface (Unix socket) |
| `BaseWebSocketManager` | Shared connection lifecycle and message routing |
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
| `settings.ts` | VS Code config bindings |

Tests: Mocha (not Vitest), mock `vscode` module via `setup.js`

---

## Electron (`electron/`) — Experimental (Inactive)

Scaffolded desktop wrapper experiment. Not the primary desktop path — the Electron app (`tray/`) is the active desktop component.

Contains: `WindowManager`, `ServerManager`, `TrayManager`, `MenuManager`, `ShortcutManager`, `AutoUpdater`, `ConfigStore`, IPC handlers.

---

## Authentication Flows

| Client | Flow |
|--------|------|
| **VS Code** | Server writes token to `~/.terminar/token` → extension reads it automatically |
| **Electron App** | Connects via Unix socket, reads token from `~/.terminar/token` |

---

## Message Flow

```
Client ──[ClientMessage JSON]──→ Transport ──→ Server message dispatch
                                                    │
                                              Handler (auth/session/io/workspace)
                                                    │
Server ──[ServerMessage JSON]──→ Transport ──→ Client
```

Transport:
- Unix socket: 4-byte big-endian length prefix + JSON body

---

## Important Patterns & Gotchas

### Protocol Package Build Order
Must run `pnpm build` in `packages/shell-protocol/` before extension tests. Extension imports from `dist/`. The package has a `tsc --noUnusedLocals` check — remove unused imports.

### Environment
`cargo` is at `~/.cargo/bin/cargo` — may need to prepend to PATH.
