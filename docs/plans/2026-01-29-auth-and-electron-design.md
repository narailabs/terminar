# Authentication & Electron App Design

**Date**: 2026-01-29
**Status**: Draft
**Author**: Brainstorming session

## Overview

This document defines the authentication system and Electron app architecture for terminar. The goal is to support both local and remote access securely, with OS-level authentication (password via PAM + SSH public key challenge-response), packaged as an Electron app with system tray controls.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth backend | OS-level users (PAM + SSH keys) | Zero user management. Reuses existing SSH keys. Familiar mental model. |
| Transport encryption | TLS (WSS) | Encrypts all data + verifies server identity. Already implemented. |
| Session tokens | JWT | Stateless reconnection without re-entering credentials. |
| User model | Single-user now, multi-user ready | Pragmatic: ship fast, design for scale. |
| Electron scope | Full bundle + remote connect | Self-contained app that also connects to remote servers. |
| Platform priority | macOS first, then Linux, then Windows | Ship on dev machine first. Full cross-platform roadmap. |
| Distribution | Direct download first | GitHub Releases. Homebrew/apt/snap/npm later. |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Deployment Modes                         │
├──────────────────┬──────────────────┬───────────────────────────┤
│   VS Code Ext    │   Electron App   │     Standalone Server     │
│  (existing)      │  (new)           │     (existing)            │
│                  │                  │                           │
│  Extension hosts │  Electron bundles│     cargo install /       │
│  Rust server as  │  Rust server +   │     brew install          │
│  child process   │  web frontend    │     runs headless         │
│  Unix socket     │  Local + Remote  │     WebSocket + TLS       │
└────────┬─────────┴────────┬─────────┴─────────────┬─────────────┘
         │                  │                       │
         ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Rust Server Core                           │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │  PTY Mgr │  │ Auth Module  │  │ TLS/WSS    │  │ Session  │  │
│  │          │  │              │  │ Transport   │  │ Persist  │  │
│  │ portable │  │ • PAM (pwd)  │  │            │  │          │  │
│  │ -pty     │  │ • SSH pubkey │  │ • Unix sock│  │ • State  │  │
│  │          │  │ • Token/API  │  │ • WebSocket│  │ • History │  │
│  │          │  │ • Session JWT│  │ • TLS(rust)│  │          │  │
│  └──────────┘  └──────────────┘  └────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle**: One Rust server binary, one web frontend, multiple ways to package and connect. Authentication is always handled by the server regardless of how clients connect.

**Connection flows**:
- **Local (Electron/VS Code)**: Unix socket, no auth needed (same-user process)
- **Remote (browser/Electron)**: WSS (WebSocket over TLS), auth required (password or SSH-key challenge)

## Authentication Design

Three auth methods, all over WSS (TLS-encrypted WebSocket):

### Method 1: OS Password (PAM)

```
Client                          Server
  │                               │
  │──── WSS Connect ─────────────►│
  │                               │
  │──── { type: "auth",          │
  │       method: "password",     │
  │       username: "narayan",    │
  │       password: "..." } ─────►│
  │                               │── PAM verify(username, password)
  │                               │
  │◄─── { type: "auth_ok",       │
  │       token: "<JWT>",         │
  │       expires: "..." } ──────│
  │                               │
  │  (subsequent messages use JWT)│
```

- Server uses PAM (`pam` crate on macOS/Linux) to verify OS credentials.
- On success, server issues a **JWT session token** (signed with server's private key, expires in 24h by default).
- Client stores the JWT and uses it for reconnection without re-entering password.
- **macOS**: Uses `pam_opendirectory`. Server needs no special privileges for the current user.
- **Linux**: Uses standard PAM. May need to be in the `shadow` group.
- **Windows** (future): `LogonUserW` Win32 API.

### Method 2: SSH Public Key Challenge-Response

```
Client                          Server
  │                               │
  │──── WSS Connect ─────────────►│
  │                               │
  │──── { type: "auth",          │
  │       method: "pubkey_init",  │
  │       username: "narayan",    │
  │       pubkey: "<base64>" } ──►│
  │                               │── Check ~/.ssh/authorized_keys
  │                               │── Generate random nonce
  │◄─── { type: "auth_challenge",│
  │       nonce: "<base64>" } ───│
  │                               │
  │  (client signs nonce with     │
  │   private key)                │
  │                               │
  │──── { type: "auth",          │
  │       method: "pubkey_verify",│
  │       signature: "<base64>",  │
  │       algorithm: "ssh-ed25519"│
  │     } ──────────────────────►│
  │                               │── Verify signature against pubkey
  │◄─── { type: "auth_ok",       │
  │       token: "<JWT>" } ──────│
```

- Reads `~/.ssh/authorized_keys` for the target user.
- Standard SSH challenge-response: server sends nonce, client signs with private key.
- In **browser**: Uses Web Crypto API (user pastes or uploads their private key, or uses a browser extension).
- In **Electron**: Reads `~/.ssh/id_ed25519` directly (main process has filesystem access).
- Supports: `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256`.

### Method 3: Token/JWT (Reconnection)

- After initial auth (password or pubkey), client receives a JWT.
- JWT contains: `sub` (username), `iat`, `exp`, `server_id`.
- On reconnect, client sends `{ type: "auth", method: "token", token: "<JWT>" }`.
- Server validates signature + expiry. No PAM call or key challenge needed.
- Tokens can be revoked server-side (stored revocation list).

### Local Connections (No Auth)

- Unix socket connections from the same UID skip auth entirely (same as today).
- Electron in local mode uses Unix socket — no login prompt.

## Electron App Design

### App Structure

```
electron/
├── src/
│   ├── main/                    # Main process (Node.js)
│   │   ├── index.ts             # App lifecycle, single-instance lock
│   │   ├── WindowManager.ts     # BrowserWindow management
│   │   ├── ServerManager.ts     # Embedded Rust server lifecycle
│   │   ├── TrayManager.ts       # System tray icon + menu
│   │   ├── RemoteManager.ts     # Remote connection profiles
│   │   ├── AutoUpdater.ts       # Electron auto-update
│   │   └── ipc.ts               # IPC bridge (main ↔ renderer)
│   ├── renderer/                # Renderer process (web frontend)
│   │   └── index.html           # Loads the Svelte web frontend
│   └── preload/
│       └── index.ts             # Secure IPC exposure
├── resources/
│   ├── icons/                   # App icons (macOS .icns, Win .ico, Linux .png)
│   ├── bin/                     # Bundled Rust server binaries per platform
│   └── tray/                    # Tray icon variants (idle, active, remote)
└── electron-builder.yml         # Build + packaging config
```

### Two Modes of Operation

**Local Mode** (default on launch):
1. Electron starts the bundled Rust server as a child process
2. Connects via Unix socket (no auth needed)
3. Tray icon shows "Local" state
4. Server only listens on Unix socket (not exposed to network)

**Remote Mode** (connect to another machine):
1. User enters server address (e.g., `wss://myserver.com:8444`)
2. Auth dialog: choose password or SSH key
3. For SSH key: Electron reads `~/.ssh/id_ed25519` via main process (no browser limitations)
4. On success, JWT is cached in Electron's secure storage (`safeStorage` API)
5. Tray icon shows "Remote: myserver" state

### System Tray Control Panel

```
┌─────────────────────────────────┐
│ ● terminar           │
├─────────────────────────────────┤
│ Server: Running (local)         │
│ ─────────────────────────────── │
│ ▸ Open Terminal Window          │
│ ▸ Sessions (3 active)           │
│   ├ Terminal 1 — ~/projects     │
│   ├ Terminal 2 — ~/src          │
│   └ Claude Code — ~/narai       │
│ ─────────────────────────────── │
│ ▸ Remote Access                 │
│   ├ ○ Enable Remote Access      │
│   ├ Port: 8444 (TLS)            │
│   ├ Connected: 0 clients        │
│   └ Copy Connection URL         │
│ ▸ Connect to Remote Server...   │
│ ─────────────────────────────── │
│ ▸ Connections                   │
│   └ (saved remote profiles)     │
│ ▸ View Logs                     │
│ ▸ Settings                      │
│ ─────────────────────────────── │
│   Quit                          │
└─────────────────────────────────┘
```

Key features:
- **"Enable Remote Access" toggle**: When enabled, server starts TLS listener + requires auth. When disabled, only Unix socket (local).
- **Session list**: Quick access to active sessions without opening the full window.
- **Connection profiles**: Save remote server addresses with nicknames for quick switching.
- **Copy Connection URL**: Generates `wss://hostname:port` for sharing.

## Implementation Roadmap

### Phase 1: Authentication Foundation (macOS)

**1.1 — JWT Session Tokens**
- Add `jsonwebtoken` crate to Rust server
- Generate server signing key on first run (stored in `~/.terminar/server.key`)
- Issue JWT on successful auth, validate on reconnect
- Add `auth_ok` message with token to wire protocol
- Update `ShellClient` (TypeScript) to store and reuse JWT

**1.2 — Password Auth (PAM)**
- Add `pam` crate to Rust server
- New auth handler: `handle_password_auth(username, password) → JWT`
- PAM service file for macOS (`/etc/pam.d/terminar`)
- Add `password` auth method to wire protocol messages (both Rust and Zod schemas)
- Web frontend: login dialog (username + password fields)

**1.3 — SSH Public Key Auth**
- Parse `~/.ssh/authorized_keys` (support OpenSSH format)
- Implement challenge-response: generate nonce, verify signature
- Add `ssh-ed25519` and `ssh-rsa` signature verification (`ring` or `ssh-key` crate)
- Add `pubkey_init`, `auth_challenge`, `pubkey_verify` messages to protocol
- Web frontend: key upload/paste dialog with Web Crypto signing
- Shell protocol client: add challenge-response flow

**1.4 — Auth UI (Web Frontend)**
- Login page with two tabs: Password / SSH Key
- "Remember me" checkbox (stores JWT in localStorage for web, `safeStorage` for Electron)
- Connection status indicator
- Logout button (revokes JWT)

### Phase 2: Electron App (macOS)

**2.1 — Electron Shell**
- Set up electron-builder with Svelte integration
- Load web frontend in BrowserWindow (reuse existing Svelte app)
- IPC bridge for main ↔ renderer communication
- App icon, dock integration, `Cmd+Q` handling
- Single-instance lock (prevent multiple app instances)

**2.2 — Embedded Server**
- `ServerManager`: spawn bundled Rust binary as child process
- Auto-start server on app launch
- Health check monitoring (poll `/health`)
- Graceful shutdown on app quit
- Bundle platform-specific Rust binary in `resources/bin/`

**2.3 — System Tray**
- `TrayManager`: native tray icon with context menu
- Menu items: Open Window, Sessions list, Remote Access toggle, Quit
- Tray icon states: idle (gray), active (green), remote (blue)
- "Enable Remote Access" toggle: starts/stops TLS listener via server API
- "Copy Connection URL" menu item

**2.4 — Remote Connection Manager**
- `RemoteManager`: save/load connection profiles
- Connect-to-remote dialog (address, auth method)
- SSH key auth: read `~/.ssh/id_ed25519` from filesystem (main process)
- JWT caching via Electron's `safeStorage` API
- Switch between local and remote servers

### Phase 3: Security Hardening

**3.1 — TLS Certificate Management**
- Auto-generate self-signed cert on first "Enable Remote Access"
- Store cert/key in `~/.terminar/tls/`
- Display certificate fingerprint for manual verification
- Option to use Let's Encrypt or custom cert

**3.2 — Rate Limiting & Brute Force Protection**
- Failed auth attempt counter per IP
- Exponential backoff after 5 failed attempts
- Account lockout after 10 failed attempts (configurable)
- Logging of all auth events for audit

**3.3 — Session Security**
- JWT refresh tokens (short-lived access + long-lived refresh)
- Concurrent session limits per user
- Session timeout for inactive connections
- Force-disconnect remote clients from tray menu

### Phase 4: Linux Support

**4.1 — Server on Linux**
- PAM integration (already cross-platform via `pam` crate)
- Verify `authorized_keys` parsing on Linux
- Test with systemd service (existing deploy/ configs)
- Package as `.deb` and `.tar.gz`

**4.2 — Electron on Linux**
- electron-builder Linux targets: `.AppImage`, `.deb`, `.snap`
- System tray: `libappindicator` integration
- Desktop file + icon registration
- Test on Ubuntu 22.04+, Fedora 38+

### Phase 5: Windows Support

**5.1 — Server on Windows**
- Replace PAM with `LogonUserW` Win32 API for password auth
- Replace Unix socket with Named Pipes (`\\.\pipe\terminar`)
- ConPTY integration (portable-pty already supports this)
- Verify SSH key parsing on Windows (`%USERPROFILE%\.ssh\authorized_keys`)
- Package as `.msi` installer

**5.2 — Electron on Windows**
- electron-builder Windows targets: `.exe` (NSIS installer), `.msi`
- System tray: native Windows notification area
- Windows Credential Manager for JWT storage (via `safeStorage`)
- Code signing certificate
- Test on Windows 10/11

### Phase 6: Distribution & Polish

**6.1 — Direct Download**
- GitHub Releases with auto-generated binaries (CI/CD)
- Platform-specific installers (`.dmg`, `.AppImage`, `.exe`)
- Auto-update via `electron-updater` (Electron) or Sparkle (standalone)

**6.2 — Package Managers**
- Homebrew cask for macOS: `brew install --cask terminar`
- Homebrew formula for server-only: `brew install terminar`
- APT repository for Debian/Ubuntu
- Snap Store for Linux
- npm package (if applicable): `npx terminar`

**6.3 — Polish**
- First-run wizard (choose local-only vs remote-enabled)
- Connection troubleshooting dialog
- Documentation site
- Accessibility audit
