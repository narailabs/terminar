# CLAUDE.md - terminar

## No Mocking Policy (MANDATORY)

**NEVER use mock PTY, mock data, or any mock/stub options unless the user explicitly asks for it.** Always use `pnpm dev` (real PTY). Always use `cargo run -- --no-auth`, never `--mock-pty`. If a real dependency is unavailable, fail explicitly rather than silently using fakes.

## Overview

Persistent terminal sessions that survive crashes and restarts. A Rust server manages PTY sessions, with multiple client frontends. Think of it as a built-in tmux.

**Full architecture reference:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Directory Structure

```
terminar/
├── server/                  # Rust backend (terminar-server)
│   └── src/
│       ├── main.rs          # Single-user server entry point
│       ├── lib.rs           # Server core: routing, message dispatch
│       ├── handlers/        # Message handlers (auth, session, I/O, workspace)
│       ├── session.rs       # PTY session lifecycle
│       ├── pty.rs           # PTY spawning (portable-pty)
│       ├── messages.rs      # Wire protocol types (Rust side)
│       ├── auth.rs          # Token auth
│       ├── persistence.rs   # Session state persistence
│       ├── history.rs       # Terminal output history (zstd compressed)
│       ├── config.rs        # CLI args (clap)
│       └── logging.rs       # Tracing configuration
├── tray/                    # Electron desktop app (Svelte 5 + xterm.js)
│   └── src/
│       ├── main/            # Electron main process (tray, health, service, config, IPC)
│       ├── preload/         # contextBridge API (trayAPI)
│       └── renderer/        # Svelte: Terminal UI, Settings, Install wizard
├── extension/               # VS Code extension (TypeScript)
│   └── src/                 # ServerController, SessionManager, NetSocketAdapter
├── packages/
│   └── shell-protocol/      # Shared TypeScript protocol (@narai/terminar-protocol)
│       └── src/             # Zod schemas, ShellClient, BaseWebSocketManager
├── electron/                # Electron desktop app (experimental, inactive)
├── docs/                    # API docs, architecture plans, security guides
│   ├── ARCHITECTURE.md      # Detailed architecture reference (READ THIS)
│   ├── API.md               # Protocol & REST API reference
│   └── plans/               # Design documents for major features
└── package.json             # Root workspace (pnpm monorepo)
```

## Architecture

### Single-User Mode (local development)

```
Electron App (tray/) ──Unix Socket──► terminar-server
                                           │
VS Code Extension ────Unix Socket──►       │
                                      PTY Sessions (portable-pty)
```

### Components

- **terminar-server** (`server/`): Single-user PTY server. Unix socket only. Token auth via `~/.terminar/token`.
- **Electron App** (`tray/`): Desktop app with integrated terminal UI (xterm.js), service management, settings, install wizard.
- **VS Code Extension** (`extension/`): Connects via Unix socket with length-prefixed framing.
- **Protocol Package** (`packages/shell-protocol/`): Zod schemas, ShellClient, BaseWebSocketManager. Shared by tray + extension.
- **Electron** (`electron/`): Experimental desktop wrapper (inactive).

> **Note:** Multi-user gateway and web frontend are deferred to v2.

## Build & Test Commands

### Root-level shortcuts (preferred)

```bash
pnpm dev                     # Start server + tray (USE THIS BY DEFAULT)
pnpm build                   # Build server (release) + tray
pnpm test                    # Test server
pnpm test:server             # Test server only
pnpm test:extension          # Test extension only
pnpm tray:dev                # Run tray app only (Electron dev)
pnpm tray:test               # Test tray app (unit + e2e)
```

### Rust Server

```bash
cd server
cargo build                  # Debug build
cargo build --release        # Release build
cargo test                   # Run tests
cargo clippy                 # Lint
cargo run -- --no-auth       # Dev mode (USE THIS BY DEFAULT)
```

### Electron App (Tray)

```bash
cd tray
pnpm dev                     # Run in dev mode (Electron + Vite)
pnpm test -- --run           # Vitest unit tests
npx playwright test          # Playwright E2E tests
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
4. `tray` → `pnpm build` (Electron + Svelte, independent of server)

## Key Files

| File | Purpose |
|------|---------|
| `packages/shell-protocol/src/messages.ts` | Wire protocol schemas (Zod) - single source of truth |
| `packages/shell-protocol/src/client.ts` | `ShellClient` class + `IShellSocket` interface |
| `server/src/handlers/` | Server-side message handlers (auth, session, I/O, workspace) |
| `server/src/pty.rs` | PTY spawning and management |
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
