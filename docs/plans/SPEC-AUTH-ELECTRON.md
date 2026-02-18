# SPEC: Authentication & Electron App

*Generated: 2026-01-29 | Design: [auth-and-electron-design.md](./2026-01-29-auth-and-electron-design.md)*

## Summary

Add OS-level authentication (PAM password + SSH public key challenge-response + JWT session tokens) and an Electron desktop app (bundled Rust server + web frontend, system tray control panel, local/remote modes) to the terminar project.

- **Primary users**: Developers who want persistent terminal sessions accessible locally and remotely
- **User model**: Single-user now, multi-user ready
- **Platforms**: macOS first, then Linux, then Windows
- **Distribution**: Direct download first, then Homebrew/apt/snap/npm

## Requirements

### Authentication (Phase 1)

#### 1.1 JWT Session Tokens [must-have]
- [ ] Add `jsonwebtoken` crate to Rust server
- [ ] Generate server signing key on first run (`~/.terminar/server.key`)
- [ ] Issue JWT on successful auth (24h expiry, server-signed)
- [ ] JWT payload: `sub` (username), `iat`, `exp`, `server_id`
- [ ] Validate JWT on reconnect (signature + expiry check)
- [ ] Server-side token revocation list
- [ ] Add `auth_ok` message with token to wire protocol (Rust + Zod)
- [ ] Update `ShellClient` to store and reuse JWT

#### 1.2 Password Auth via PAM [must-have]
- [ ] Add `pam` crate to Rust server
- [ ] `handle_password_auth(username, password) -> JWT`
- [ ] PAM service file for macOS (`/etc/pam.d/terminar`)
- [ ] Add `{ type: "auth", method: "password", username, password }` to protocol
- [ ] Passwords never stored — verified via PAM in real-time
- [ ] macOS: `pam_opendirectory` (no elevated privileges needed for current user)

#### 1.3 SSH Public Key Challenge-Response [must-have]
- [ ] Parse `~/.ssh/authorized_keys` (OpenSSH format)
- [ ] Generate cryptographic nonce for challenge
- [ ] Verify signature against registered public key
- [ ] Support `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256`
- [ ] Add `pubkey_init`, `auth_challenge`, `pubkey_verify` messages to protocol
- [ ] Use `ring` or `ssh-key` crate for signature verification

#### 1.4 Auth UI (Web Frontend) [must-have]
- [ ] Login page with two tabs: Password / SSH Key
- [ ] Password tab: username + password fields
- [ ] SSH Key tab: key file upload/paste + Web Crypto signing
- [ ] "Remember me" checkbox (JWT in localStorage for web, `safeStorage` for Electron)
- [ ] Connection status indicator
- [ ] Logout button (revokes JWT server-side)

#### 1.5 Local Connection Bypass [must-have]
- [ ] Unix socket connections from same UID skip auth entirely
- [ ] Preserve existing `--no-auth` flag for development

### Electron App (Phase 2)

#### 2.1 Electron Shell [must-have]
- [ ] electron-builder with Svelte integration
- [ ] Load web frontend in BrowserWindow (reuse existing Svelte app)
- [ ] IPC bridge for main <-> renderer communication
- [ ] Context isolation, no node integration, sandbox mode
- [ ] App icon, dock integration, `Cmd+Q` handling
- [ ] Single-instance lock

#### 2.2 Embedded Server [must-have]
- [ ] `ServerManager`: spawn bundled Rust binary as child process
- [ ] Auto-start server on app launch
- [ ] Health check monitoring (poll `/health`)
- [ ] Graceful shutdown on app quit
- [ ] Bundle platform-specific Rust binary in `resources/bin/`

#### 2.3 System Tray [must-have]
- [ ] Native tray icon with context menu
- [ ] Server status (Running/Stopped)
- [ ] Open Terminal Window
- [ ] Sessions list with active session count
- [ ] Remote Access submenu:
  - [ ] Enable/Disable Remote Access toggle
  - [ ] Port display (TLS)
  - [ ] Connected clients count
  - [ ] Copy Connection URL
- [ ] Connect to Remote Server...
- [ ] Saved connection profiles
- [ ] View Logs
- [ ] Settings
- [ ] Quit
- [ ] Tray icon states: idle (gray), active (green), remote (blue)

#### 2.4 Remote Connection Manager [must-have]
- [ ] Save/load connection profiles (name, address, auth method)
- [ ] Connect-to-remote dialog
- [ ] SSH key auth: read `~/.ssh/id_ed25519` from filesystem (main process)
- [ ] JWT caching via Electron's `safeStorage` API
- [ ] Switch between local and remote servers

### Security Hardening (Phase 3)

#### 3.1 TLS Certificate Management [must-have]
- [ ] Auto-generate self-signed cert on first "Enable Remote Access"
- [ ] Store cert/key in `~/.terminar/tls/`
- [ ] Display certificate fingerprint for manual verification
- [ ] Support custom certificates

#### 3.2 Rate Limiting & Brute Force Protection [must-have]
- [ ] Failed auth attempt counter per IP
- [ ] Exponential backoff after 5 failed attempts
- [ ] Account lockout after 10 failed attempts (configurable)
- [ ] Audit logging of all auth events

#### 3.3 Session Security [should-have]
- [ ] JWT refresh tokens (short-lived access + long-lived refresh)
- [ ] Concurrent session limits per user
- [ ] Session timeout for inactive connections
- [ ] Force-disconnect remote clients from tray menu

### Linux Support (Phase 4)

#### 4.1 Server on Linux [must-have]
- [ ] PAM integration (cross-platform via `pam` crate)
- [ ] Verify `authorized_keys` parsing
- [ ] systemd service (existing deploy/ configs)
- [ ] Package as `.deb` and `.tar.gz`

#### 4.2 Electron on Linux [must-have]
- [ ] electron-builder targets: `.AppImage`, `.deb`, `.snap`
- [ ] System tray: `libappindicator` integration
- [ ] Desktop file + icon registration
- [ ] Test on Ubuntu 22.04+, Fedora 38+

### Windows Support (Phase 5)

#### 5.1 Server on Windows [should-have]
- [ ] Replace PAM with `LogonUserW` Win32 API for password auth
- [ ] Replace Unix socket with Named Pipes (`\\.\pipe\terminar`)
- [ ] ConPTY integration (portable-pty already supports this)
- [ ] SSH key parsing (`%USERPROFILE%\.ssh\authorized_keys`)
- [ ] Package as `.msi` installer

#### 5.2 Electron on Windows [should-have]
- [ ] electron-builder targets: `.exe` (NSIS installer), `.msi`
- [ ] System tray: native Windows notification area
- [ ] Windows Credential Manager for JWT storage (via `safeStorage`)
- [ ] Code signing certificate
- [ ] Test on Windows 10/11

### Distribution & Polish (Phase 6)

#### 6.1 Direct Download [must-have]
- [ ] GitHub Releases with CI/CD auto-generated binaries
- [ ] Platform-specific installers (`.dmg`, `.AppImage`, `.exe`)
- [ ] Auto-update via `electron-updater`

#### 6.2 Package Managers [nice-to-have]
- [ ] Homebrew cask: `brew install --cask terminar`
- [ ] Homebrew formula (server-only): `brew install terminar`
- [ ] APT repository for Debian/Ubuntu
- [ ] Snap Store for Linux
- [ ] npm package: `npx terminar`

#### 6.3 Polish [nice-to-have]
- [ ] First-run wizard (local-only vs remote-enabled)
- [ ] Connection troubleshooting dialog
- [ ] Documentation site
- [ ] Accessibility audit

## Security Constraints

| Constraint | Implementation |
|------------|---------------|
| Transport encryption | TLS (WSS) for all remote connections |
| Server authentication | TLS certificate verifies server identity |
| Client authentication | PAM password or SSH pubkey challenge-response |
| Session tokens | JWT (24h expiry, server-signed, revocable) |
| Credential storage | Electron `safeStorage`, browser localStorage (JWT only) |
| Passwords | Never stored, verified via PAM in real-time |
| SSH private keys | Never leave the client |
| Local connections | Unix socket, same-UID bypass, no auth needed |
| Brute force | Rate limiting + exponential backoff + lockout |
| Audit | All auth events logged |

## Wire Protocol Additions

New client messages:
- `{ type: "auth", method: "password", username: string, password: string }`
- `{ type: "auth", method: "pubkey_init", username: string, pubkey: string }`
- `{ type: "auth", method: "pubkey_verify", signature: string, algorithm: string }`
- `{ type: "auth", method: "token", token: string }`

New server messages:
- `{ type: "auth_ok", token: string, expires: string }`
- `{ type: "auth_challenge", nonce: string }`

## Out of Scope

- Multi-user access control (deferred to future phase)
- Let's Encrypt auto-provisioning (custom cert only for now)
- Mobile apps (desktop-first, responsive web only)
- SSH tunnel/daemon embedding (WSS provides equivalent security)

## Architecture Diagrams

See [auth-and-electron-design.md](./2026-01-29-auth-and-electron-design.md) for:
- Full architecture diagram
- PAM auth sequence diagram
- SSH pubkey challenge-response sequence diagram
- Electron app structure
- System tray control panel mockup
