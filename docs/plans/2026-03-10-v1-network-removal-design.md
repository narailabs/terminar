# V1: Remove Network Access Features

**Date:** 2026-03-10
**Status:** Approved

## Summary

Strip all network access features from v1. The server communicates exclusively via Unix socket (or stdio for Windows/WSL). No TCP ports, no HTTP/WebSocket listeners, no TLS, no multi-user auth. Production clients are the Electron app and VS Code extension. The web frontend is removed entirely — Electron with livereload replaces it for development.

## V1 Architecture

```
Electron App (tray/)                VS Code Extension (extension/)
    │                                       │
    └──── Unix Socket ─────┬──── Unix Socket ┘
                           │
                    terminar-server
                           │
                      PTY Sessions
                    (portable-pty)
```

- **Socket:** `~/.terminar/server.sock` (parent dir permissions `0700`)
- **Zero network exposure:** No TCP ports, no HTTP, no network stack
- **Server lifecycle:** Electron spawns server as child process; shuts down on quit (or stays alive for VS Code reconnection)

## Platform Support

| Platform | Server | Electron | Transport |
|----------|--------|----------|-----------|
| macOS | Native binary (bundled in `.app`) | Native `.app` / `.dmg` | Unix socket |
| Linux | Native binary (bundled) | `.AppImage` / `.deb` | Unix socket |
| Windows | Linux binary via WSL | Native `.exe` | stdio bridge (`--stdio`) |

### Windows/WSL Strategy

The Electron app is a native Windows `.exe` with system tray support. The server runs inside WSL as a Linux binary. Communication uses stdio (stdin/stdout) to avoid Unix socket cross-boundary issues.

**WSL detection flow:**
1. Electron launches, detects Windows via `process.platform`
2. Checks `wsl.exe --status` for WSL availability
3. **No WSL:** Shows install guide dialog — explains WSL, provides `wsl --install` command, links to Microsoft docs, "Check again" button
4. **WSL but no distro:** Prompts to install default distro (`wsl --install -d Ubuntu`)
5. **WSL ready:** Copies/verifies server binary in WSL filesystem, launches via `wsl.exe terminar-server --stdio`
6. Communicates via stdin/stdout using same length-prefixed JSON framing

## What Gets Removed

### Deleted Files

| File/Directory | Reason |
|----------------|--------|
| `server/src/bin/gateway.rs` | Multi-user gateway binary |
| `server/src/gateway/` | Gateway module (config, proxy, user_server) |
| `server/src/tls.rs` | TLS / self-signed cert generation |
| `server/src/cookies.rs` | Browser cookie auth |
| `server/src/revocation.rs` | Token revocation store |
| `server/src/security_headers.rs` | CSP/HSTS/X-Frame-Options middleware |
| `server/src/audit.rs` | Security event audit logging |
| `server/src/auth.rs` | PAM, SSH key, token auth |
| `server/src/jwt.rs` | JWT signing/verification |
| `deploy/` | Systemd, launchd, sudoers configs |
| `web/` | Standalone web frontend (entire directory) |

### Removed from Cargo.toml

`rustls`, `rustls-pemfile`, `axum-server`, `rcgen`, `ring`, `ssh-key`, `signature`, `jsonwebtoken`, `base64` (if only used for auth)

### Simplified Files

- **`server/src/lib.rs`** — Remove TCP/HTTP listener, all auth handlers, axum routes, CORS, static file serving. Keep Unix socket listener + message dispatch.
- **`server/src/config.rs`** — Strip to `--socket`, `--stdio`, `--shell`. Remove TLS, auth, gateway, CORS flags.
- **`server/src/main.rs`** — Simplified entry point.
- **`server/src/handlers/`** — Remove auth handlers. Keep session, IO, workspace handlers.

### Kept Unchanged

`session.rs`, `pty.rs`, `persistence.rs`, `history.rs`, `process.rs`, `messages.rs`, `logging.rs` — core terminal functionality.

## Server After Simplification

```
server/src/
├── main.rs          # CLI: --socket, --stdio, --shell
├── lib.rs           # Unix socket listener + stdio mode, message dispatch
├── config.rs        # Minimal CLI args
├── session.rs       # PTY lifecycle
├── pty.rs           # PTY spawning (portable-pty)
├── messages.rs      # Wire protocol types
├── persistence.rs   # Session state persistence
├── history.rs       # Terminal output history (zstd)
├── process.rs       # Foreground process detection
├── logging.rs       # Tracing config
└── handlers/
    ├── session.rs   # Create/attach/detach/close
    ├── io.rs        # Input/output/resize
    └── workspace.rs # Workspace state
```

**CLI:**
```
terminar-server [OPTIONS]
  --socket <PATH>    Unix socket path [default: ~/.terminar/server.sock]
  --stdio            Communicate via stdin/stdout (for Windows/WSL)
  --shell <SHELL>    Default shell [default: $SHELL or /bin/bash]
```

**Two transport modes:**
1. **Unix socket** (default) — macOS/Linux, used by Electron and VS Code extension
2. **stdio** (`--stdio`) — Windows/WSL, Electron spawns `wsl.exe terminar-server --stdio`

Both use length-prefixed JSON framing (4-byte big-endian length + JSON payload).

## Electron App Changes

The `tray/` app transforms from gateway service manager to primary terminal UI + server manager.

### Removed from tray/
- Gateway health polling
- Service management (elevated bash scripts for launchd/systemd)
- Install wizard for gateway system service

### Added to tray/
- Terminal UI components (migrated from `web/src/components/` — Terminal, Pane, WorkspaceView, Sidebar, tabs, themes, keybindings)
- Direct server spawning as child process
- stdio transport mode for Windows/WSL
- WSL detection + install guide dialog
- System tray icon (macOS, Linux, Windows — Electron `Tray` API)

### Packaging
- macOS: `.dmg` with `terminar-server` in `Resources/`
- Linux: `.AppImage` or `.deb` with server binary bundled
- Windows: `.exe` installer with Linux server binary, copied into WSL on first launch

## Error Handling & Edge Cases

**Server crash recovery:**
- Electron detects child process exit → notification → auto-restart
- Stale socket: server removes `server.sock` on startup if exists
- VS Code extension: reconnects when socket reappears

**Multiple instances:**
- Socket file acts as natural lock — second server fails to bind, exits with clear error
- Electron checks for existing responsive server before spawning

**Windows/WSL edge cases:**
- No WSL: dialog with install instructions + "Check again" button
- No distro: prompt for `wsl --install -d Ubuntu`
- Server binary missing in WSL: copy on first run from bundled resources
- WSL process dies: detect stdio close → restart

## Deferred to V2

- Multi-user gateway (`terminar-gateway`)
- TLS / remote access
- PAM / SSH key authentication
- JWT refresh/revocation lifecycle
- Audit logging
- Network (TCP/HTTP/WebSocket) listeners
- Security headers middleware
- System service deployment (systemd/launchd)
- Native Windows support (named pipes, no WSL dependency)
