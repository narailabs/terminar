# CLAUDE.md - terminar

## No Mocking Policy (MANDATORY)

**NEVER use mock PTY, mock data, or any mock/stub options unless the user explicitly asks for it.** Always use `pnpm dev` (real PTY), never `pnpm dev:mock`. Always use `cargo run -- --no-auth`, never `--mock-pty`. If a real dependency is unavailable, fail explicitly rather than silently using fakes.

## Overview

Persistent terminal sessions that survive crashes and restarts. A Rust server manages PTY sessions, with multiple client frontends. Think of it as a built-in tmux.

**Full architecture reference:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Directory Structure

```
terminar/
├── server/                  # Rust backend (2 binaries: terminar-server + terminar-gateway)
│   └── src/
│       ├── main.rs          # Single-user server entry point
│       ├── bin/gateway.rs   # Multi-user gateway entry point
│       ├── gateway/         # Gateway: auth, proxy, per-user server spawning
│       ├── lib.rs           # Server core: routing, message dispatch
│       ├── handlers/        # Message handlers (auth, session, I/O, workspace)
│       ├── session.rs       # PTY session lifecycle
│       ├── pty.rs           # PTY spawning (portable-pty)
│       ├── messages.rs      # Wire protocol types (Rust side)
│       ├── auth.rs          # Token/password/SSH key auth
│       ├── jwt.rs           # JWT signing & verification
│       ├── tls.rs           # TLS setup, self-signed cert generation
│       ├── persistence.rs   # Session state persistence
│       ├── history.rs       # Terminal output history (zstd compressed)
│       ├── audit.rs         # Security event logging
│       ├── config.rs        # CLI args (clap)
│       └── logging.rs       # Tracing configuration
├── web/                     # Web frontend (Svelte 5 + xterm.js + Vite)
│   └── src/
│       ├── App.svelte       # Root component
│       ├── components/      # ~20 components: Terminal, Pane, WorkspaceView, Sidebar, etc.
│       └── lib/             # ~50 modules: stores, managers, keybindings, themes
├── tray/                    # System tray app (Electron + Svelte 5)
│   └── src/
│       ├── main/            # Electron main process (tray, health, service, config, IPC)
│       ├── preload/         # contextBridge API (trayAPI)
│       └── renderer/        # Svelte: Install wizard, Settings window
├── extension/               # VS Code extension (TypeScript)
│   └── src/                 # ServerController, SessionManager, NetSocketAdapter
├── packages/
│   └── shell-protocol/      # Shared TypeScript protocol (@narai/terminar-protocol)
│       └── src/             # Zod schemas, ShellClient, BaseWebSocketManager
├── electron/                # Electron desktop app (experimental, inactive)
├── deploy/                  # Systemd/launchd service files, sudoers, logrotate
├── docs/                    # API docs, architecture plans, security guides
│   ├── ARCHITECTURE.md      # Detailed architecture reference (READ THIS)
│   ├── API.md               # Protocol & REST API reference
│   └── plans/               # Design documents for major features
└── package.json             # Root workspace (pnpm monorepo)
```

## Architecture

### Single-User Mode (local development, VS Code)

```
VS Code Extension ──Unix Socket──► terminar-server ◄──WebSocket──► Web Frontend
                                        │
                                   PTY Sessions (portable-pty)
```

### Multi-User Mode (shared servers, production)

```
Browser ──TLS──► terminar-gateway ──sudo──► terminar-server --user-mode (per user)
                    │                              │
                Auth (password/SSH)          PTY Sessions
                JWT issuance              /run/terminar/<user>.sock
```

### System Tray (Electron)

```
Tray App (tray/) ──HTTP health──► terminar-gateway/server
     │
  Service management (launchd/systemd via elevated bash scripts)
  Settings window (Svelte 5)
  Install wizard
```

### Components

- **terminar-server** (`server/`): Single-user PTY server. Unix socket + WebSocket. Token auth via `~/.terminar/token`.
- **terminar-gateway** (`server/src/bin/gateway.rs`): Multi-user reverse proxy. TLS termination, password/SSH auth, spawns per-user servers via `sudo -u`.
- **Web Frontend** (`web/`): Svelte 5 + xterm.js. Split panes, tabs, drag-and-drop, themes, keybindings.
- **System Tray** (`tray/`): Electron tray app. Service lifecycle, health polling, settings, install wizard.
- **VS Code Extension** (`extension/`): Connects via Unix socket with length-prefixed framing.
- **Protocol Package** (`packages/shell-protocol/`): Zod schemas, ShellClient, BaseWebSocketManager. Shared by web + extension.
- **Electron** (`electron/`): Experimental desktop wrapper (inactive).

## Build & Test Commands

### Root-level shortcuts (preferred)

```bash
pnpm dev                     # Start server + web (USE THIS BY DEFAULT)
pnpm dev:tray                # Start server + web + tray (all frontends)
pnpm dev:all                 # Start server + web + tray + electron (everything)
pnpm dev:mock                # ONLY when user explicitly requests mock
pnpm build                   # Build server (release) + web
pnpm test                    # Test server + web
pnpm test:server             # Test server only
pnpm test:web                # Test web only
pnpm test:extension          # Test extension only
pnpm tray:dev                # Run tray app only (Electron dev)
pnpm tray:test               # Test tray app (unit + e2e)
```

### Rust Server

```bash
cd server
cargo build                  # Debug build
cargo build --release        # Release build (outputs terminar-server + terminar-gateway)
cargo test                   # Run tests
cargo clippy                 # Lint
cargo run -- --no-auth       # Dev mode (USE THIS BY DEFAULT)
cargo run --bin terminar-gateway -- --port 6749  # Run gateway
```

### Web Frontend

```bash
cd web
pnpm dev                     # Vite dev server (localhost:3001)
pnpm build                   # Production build
pnpm test -- --run           # Vitest (single run)
pnpm test:watch              # Vitest (watch mode)
```

### System Tray (Electron)

```bash
cd tray
pnpm dev                     # Run in dev mode (Electron + Vite)
pnpm test -- --run           # Vitest unit tests (77 tests)
npx playwright test          # Playwright E2E tests (22 tests)
pnpm build                   # Build distributable (electron-builder)
```

### Protocol Package

```bash
cd packages/shell-protocol
pnpm build                   # TypeScript → dist/ (MUST run before extension tests)
pnpm test -- --run           # Vitest
pnpm typecheck               # tsc --noEmit (has dead_code check - no unused imports!)
```

### VS Code Extension

```bash
cd extension
pnpm compile                 # TypeScript compilation
pnpm test                    # Mocha tests (requires protocol dist/)
```

### Build Order (when building from scratch)

1. `packages/shell-protocol` → `pnpm build`
2. `server` → `cargo build` (independent of TypeScript)
3. `extension` → `pnpm compile` (depends on shell-protocol dist/)
4. `web` → uses relative imports via `shared-protocol.ts` barrel
5. `tray` → `pnpm build` (Electron + Svelte, independent of server)

## Key Files

| File | Purpose |
|------|---------|
| `packages/shell-protocol/src/messages.ts` | Wire protocol schemas (Zod) - single source of truth |
| `packages/shell-protocol/src/client.ts` | `ShellClient` class + `IShellSocket` interface |
| `server/src/handlers/` | Server-side message handlers (auth, session, I/O, workspace) |
| `server/src/gateway/` | Multi-user gateway (proxy, user server lifecycle) |
| `server/src/pty.rs` | PTY spawning and management |
| `web/src/components/Terminal.svelte` | xterm.js terminal widget (write buffering, auto-scroll) |
| `web/src/lib/workspaceStore.ts` | Split pane / tab workspace state |
| `web/src/lib/sessionContext.ts` | Svelte context API for session access |
| `tray/src/main/index.ts` | Tray app entry (Electron lifecycle, orchestration) |
| `tray/src/main/ServiceManager.ts` | launchd/systemd service management (bash scripts) |
| `tray/src/main/TrayManager.ts` | System tray icon + dynamic context menu |
| `docs/ARCHITECTURE.md` | Full architecture reference |
| `docs/API.md` | API reference documentation |

## DO NOT MODIFY

- `node_modules/` - Dependencies
- `dist/` - Built output (terminar-protocol)
- `out/` - Compiled extension output
- `out-test/` - Compiled test output
- `target/` - Rust build output (cargo)
- `*.lock` files - Package lock files
