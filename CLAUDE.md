# CLAUDE.md - termiNar (VS Code Extension + Rust Server)

## No Mocking Policy (MANDATORY)

**NEVER use mock PTY, mock data, or any mock/stub options unless the user explicitly asks for it.** Always use `pnpm dev` (real PTY), never `pnpm dev:mock`. Always use `cargo run -- --no-auth`, never `--mock-pty`. If a real dependency is unavailable, fail explicitly rather than silently using fakes.

## Overview

Persistent terminal sessions that survive VS Code crashes and restarts. A Rust server manages PTY sessions, with a VS Code extension and web frontend as clients. Think of it as a built-in tmux for VS Code.

## Directory Structure

```
terminar/
├── server/                  # Rust server (PTY management, Unix socket + WebSocket)
│   └── src/
│       ├── main.rs          # Entry point, CLI parsing, socket path
│       ├── lib.rs           # Server startup, routing
│       ├── session.rs       # PTY session lifecycle
│       ├── pty.rs           # PTY spawning and I/O
│       ├── handlers/        # Request handlers (auth, session, I/O)
│       ├── messages.rs      # Wire protocol types (Rust side)
│       ├── connection.rs    # Client connection management
│       ├── persistence.rs   # Session state persistence
│       ├── config.rs        # CLI args (clap)
│       └── logging.rs       # Tracing/log configuration
├── extension/               # VS Code extension (TypeScript)
│   └── src/
│       ├── extension.ts     # Extension entry point, command registration
│       ├── ServerController.ts    # Spawns/manages the Rust server process
│       ├── SessionManager.ts      # Session CRUD via ShellClient
│       ├── SessionTreeProvider.ts # Sidebar tree view
│       ├── NetSocketAdapter.ts    # Unix socket with length-prefixed framing
│       ├── WebSocketAdapter.ts    # WebSocket adapter for remote connections
│       ├── settings.ts      # VS Code configuration bindings
│       └── test/            # Mocha test suite
├── web/                     # Web frontend (Svelte + xterm.js)
│   └── src/
│       ├── App.svelte       # Root component
│       ├── components/      # Terminal, Sidebar, TabBar, SplitContainer, etc.
│       └── lib/             # WebSocketAdapter, SessionManager, stores
├── packages/
│   └── terminar-protocol/   # Shared TypeScript protocol package (@narai/terminar-protocol)
│       └── src/
│           ├── messages.ts  # Zod schemas for client/server messages
│           ├── client.ts    # ShellClient class + IShellSocket interface
│           └── errors.ts    # Protocol error types
├── electron/                # Electron desktop app (experimental)
├── deploy/                  # Systemd service + logrotate configs
├── docs/                    # API documentation
└── package.json             # Root workspace scripts
```

## Architecture

```
VS Code Extension ──Unix Socket (length-prefixed framing)──► Rust Server ◄──WebSocket──► Web Frontend
                                                                 │
                                                              PTY Sessions
                                                          (portable-pty crate)
```

- **Rust Server** (`server/`): Manages PTY sessions via `portable-pty`. Listens on a Unix socket (for local VS Code) and HTTP/WebSocket (for web clients). Auth via token stored in `~/.terminar/token`.
- **VS Code Extension** (`extension/`): Connects to the server over a Unix socket using `NetSocketAdapter` (4-byte big-endian length prefix + JSON). Auto-starts the server binary. Provides sidebar tree view, terminal panels, and commands.
- **Web Frontend** (`web/`): Svelte app with xterm.js. Connects via WebSocket. Supports split panes, tabs, and session management.
- **termiNar Protocol** (`packages/terminar-protocol/`): Shared TypeScript package defining message schemas (Zod) and the `ShellClient` class used by both extension and web.

### Socket path

Default: `/tmp/vscode-terminar-<uid>.sock`

## Build & Test Commands

### Rust Server

```bash
cd server
cargo build                  # Debug build
cargo build --release        # Release build
cargo test                   # Run tests
cargo clippy                 # Lint
cargo run -- --no-auth       # Dev mode (USE THIS BY DEFAULT)
cargo run -- --no-auth --mock-pty  # ONLY when user explicitly requests mock
```

### VS Code Extension

```bash
cd extension
pnpm install
pnpm compile                 # TypeScript compilation
pnpm test                    # Mocha tests (requires pretest compile)
```

### Web Frontend

```bash
cd web
pnpm install
pnpm dev                     # Vite dev server
pnpm build                   # Production build
pnpm test -- --run           # Vitest (single run)
pnpm test:watch              # Vitest (watch mode)
```

### termiNar Protocol

```bash
cd packages/terminar-protocol
pnpm install
pnpm build                   # TypeScript compilation
pnpm test -- --run           # Vitest (single run)
pnpm typecheck               # Type checking only
```

### Root-level shortcuts

```bash
pnpm dev                     # Start server + web (USE THIS BY DEFAULT)
pnpm dev:mock                # ONLY when user explicitly requests mock
pnpm build                   # Build server (release) + web
pnpm test                    # Test server + web
pnpm test:server             # Test server only
pnpm test:web                # Test web only
pnpm test:extension          # Test extension only
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/terminar-protocol/src/messages.ts` | Single source of truth for the wire protocol (client/server message types) |
| `packages/terminar-protocol/src/client.ts` | `ShellClient` class and `IShellSocket` interface |
| `extension/src/NetSocketAdapter.ts` | Length-prefixed framing over Unix domain socket |
| `extension/src/ServerController.ts` | Manages the Rust server process lifecycle |
| `server/src/handlers/` | Server-side message handlers (auth, session, I/O) |
| `server/src/pty.rs` | PTY session spawning and management |
| `web/src/lib/WebSocketSessionManager.ts` | Web client session management over WebSocket |
| `docs/API.md` | API reference documentation |

## DO NOT MODIFY

- `node_modules/` - Dependencies
- `dist/` - Built output (terminar-protocol)
- `out/` - Compiled extension output
- `out-test/` - Compiled test output
- `target/` - Rust build output (cargo)
- `*.lock` files - Package lock files
