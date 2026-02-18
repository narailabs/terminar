# Security Overhaul Design

**Date:** 2026-02-16
**Status:** Approved
**Scope:** Full security overhaul — TLS, token lifecycle, audit logging, multi-user gateway

## Goals

- Harden terminar for remote access and multi-user deployment
- Support three deployment models: local-only, personal remote, shared multi-user
- All remote communication encrypted via TLS (WSS/HTTPS)
- Per-user session isolation in multi-user mode
- Structured audit logging for security events
- Secure token lifecycle with rotation and persistent revocation

## Non-Goals

- Custom user database (OS users via PAM/SSH only)
- Session sharing between users (strict isolation)
- Electron desktop app (future work)

---

## Phase 1: Foundation Hardening

### TLS

- Auto-generate self-signed ECDSA P-256 cert/key at `~/.terminar/tls/` on first startup if no cert exists (reuse existing `generate_self_signed_cert()` in `tls.rs`)
- TOFU fingerprint model: on first connection, client displays cert fingerprint for user to verify. Fingerprint pinned locally after acceptance
- User-provided certs via existing `--tls-cert`/`--tls-key` flags override self-signed
- Enforce WSS for remote: web client rejects `ws://` for non-localhost connections. Extension does the same for WebSocket connections
- HTTP-to-HTTPS redirect when TLS is configured

### Security Headers

Server adds to all HTTP responses:

- `Strict-Transport-Security: max-age=31536000` (when TLS enabled)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy: default-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'`
- `Referrer-Policy: no-referrer`

### CDN Asset Security

Bundle xterm.css into the build instead of loading from cdn.jsdelivr.net, or add SRI hash to the `<link>` tag.

### Rate Limiting Gaps

- Add rate limiting to WebSocket password auth (currently unlimited once connected)
- Track failed auth attempts per-connection on WebSocket, disconnect after 5 failures
- Fix `X-Forwarded-For` trust: add `--trusted-proxy` flag, only trust the header when configured

---

## Phase 2: Audit Logging

### Log File

- Path: `~/.terminar/audit.log`
- Format: JSON-lines (one JSON object per line)
- Rotation: integrate with existing logrotate config in `deploy/`

### Verbosity Levels

Configurable via `--audit-level` flag:

| Level | What's logged |
|-------|--------------|
| `off` | Nothing |
| `auth` | Auth events only (login success/failure) |
| `standard` (default) | Auth + session lifecycle + admin actions |
| `verbose` | Everything: auth + sessions + connections + reconnections |

### Event Schema

```json
{
  "timestamp": "2026-02-16T10:30:00Z",
  "event": "auth_success",
  "level": "auth",
  "username": "narayan",
  "method": "ssh_pubkey",
  "client_ip": "192.168.1.50",
  "connection_type": "websocket",
  "details": {}
}
```

### Events by Level

**`auth` level:**

- `auth_success` — username, method (password/ssh_pubkey/token/pairing), IP
- `auth_failure` — username (if provided), method, IP, reason
- `auth_rate_limited` — IP, attempt count
- `token_revoked` — token_id, reason (rotation/manual/logout)

**`standard` level (includes auth):**

- `session_created` — session_id, username, shell
- `session_attached` — session_id, username, client_id
- `session_detached` — session_id, username, client_id
- `session_closed` — session_id, username, reason (user/exit/kill)
- `pairing_code_generated` — by username
- `pairing_code_used` — by IP
- `server_config_changed` — what changed, by whom

**`verbose` level (includes standard):**

- `connection_opened` — client_id, IP, protocol (unix_socket/websocket)
- `connection_closed` — client_id, reason
- `reconnection_attempt` — client_id, IP, success/failure
- `token_refreshed` — username, client_id

### Implementation

- New `audit.rs` module in `server/src/`
- `AuditLogger` struct with `log(event: AuditEvent)` method
- Async file writes (buffered, flushed periodically and on shutdown)
- No sensitive data in logs (no tokens, passwords, or session output)

---

## Phase 3: Token Lifecycle + Auth Enforcement

### Access Tokens

- Short-lived: 15-minute expiry (down from 24 hours)
- JWT claims unchanged: `sub`, `server_id`, `iat`, `exp`, `token_type`
- Issued on successful password auth, SSH key auth, or pairing code exchange

### Refresh Token Rotation

- 7-day expiry
- Rotation on use: when a client uses a refresh token, the old one is revoked and a new one is issued
- One active refresh token per client session
- Server tracks: `active_refresh_tokens: HashMap<String, RefreshTokenMeta>` with username, issued_at, client_id

### Revocation Persistence

- File: `~/.terminar/revoked-tokens.jsonl` (append-only JSON-lines)
- Format: `{"token_id": "...", "revoked_at": "...", "reason": "rotation|manual|logout"}`
- Loaded into in-memory `HashSet` on startup for fast lookup
- Pruning on startup: discard entries where the token's `exp` has already passed

### HttpOnly Cookies (Browser)

After successful auth, server sets cookies via `POST /auth/session`:

```
Set-Cookie: terminar_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900
Set-Cookie: terminar_refresh=<refresh_jwt>; HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh; Max-Age=604800
```

- Initial WebSocket auth still uses message-based token
- Reconnection can use cookies (server reads cookie on WebSocket upgrade request)
- Token refresh: browser hits `POST /auth/refresh` (cookie sent automatically)
- Logout: `POST /auth/logout` clears cookies and revokes refresh token
- Remove localStorage token storage from web client

### Extension Token Storage

- Keep `~/.terminar/token` file for VS Code extension (file permissions are sufficient)
- Remove `terminar.authToken` from VS Code settings schema (avoid plaintext in settings.json)

### Auth Enforcement

- New `--require-auth` flag: forces authentication even on Unix socket and loopback WebSocket connections
- Remove the automatic loopback bypass for WebSocket connections
- Unix socket bypass remains by default (filesystem permissions = implicit auth) but can be overridden with `--require-auth`

---

## Phase 4: Multi-User Gateway + Session Isolation

### Architecture

```
                    ┌─────────────────────────────────────┐
                    │         terminar-gateway             │
                    │   (runs as 'terminar' service user)  │
                    │                                      │
  Clients ────────► │  ┌──────────┐  ┌───────────────┐    │
  (Extension,       │  │ Auth     │  │ User Server   │    │
   Web browser,     │  │ (PAM/SSH)│  │ Manager       │    │
   Electron)        │  └──────────┘  └───────┬───────┘    │
                    │                        │             │
                    └────────────────────────┼─────────────┘
                                             │
                          sudo -u <user> terminar-server --user-mode
                                             │
                    ┌────────────────────────┼─────────────┐
                    │  ┌─────────────────────────────┐     │
                    │  │ Per-User Server (alice)      │     │
                    │  │ Socket: /run/terminar/alice  │     │
                    │  │ State: ~alice/.terminar/     │     │
                    │  │ PTYs run as alice            │     │
                    │  └─────────────────────────────┘     │
                    │                                      │
                    │  ┌─────────────────────────────┐     │
                    │  │ Per-User Server (bob)        │     │
                    │  │ Socket: /run/terminar/bob    │     │
                    │  │ State: ~bob/.terminar/       │     │
                    │  └─────────────────────────────┘     │
                    └──────────────────────────────────────┘
```

### Client Access Modes

All remote traffic encrypted via TLS (WSS/HTTPS):

1. **Web version hosted by server:** client connects via `wss://server:port/ws`
2. **Local web/Electron connecting to remote server:** connects to `wss://remote-server:port/ws`
3. **VS Code extension remote:** connects via `WebSocketAdapter` to `wss://remote-server:port/ws`

### Gateway Responsibilities

1. Listen on TCP port (with TLS) and optionally Unix socket
2. Authenticate users via PAM or SSH public key
3. Spawn per-user servers on demand via `sudo -u <user> terminar-server --user-mode --socket /run/terminar/<user>.sock`
4. Proxy WebSocket traffic between client and user's server transparently
5. Health check per-user servers, restart if crashed
6. Idle timeout: shut down per-user servers after configurable idle period (default: 30 min)
7. Audit log all auth and connection events

### Gateway Implementation

- New binary: `terminar-gateway` (separate from `terminar-server`)
- Reuses existing auth code (`auth.rs`, `jwt.rs`), TLS code (`tls.rs`), and protocol types
- Thin proxy: after auth, gateway is a bidirectional WebSocket pipe. No message parsing needed
- User server discovery: checks for socket at `/run/terminar/<username>.sock`

### Per-User Server Changes (`--user-mode` flag)

- Refuses to run as root (safety check)
- Skips its own auth: trusts the gateway (gateway-to-server connection is local Unix socket with filesystem permissions)
- Binds to user-specific socket (not the shared one)
- State isolation: each user's sessions, history, and config in their own `~/.terminar/`
- Sessions tagged with UID, queries filtered by UID (defense in depth)

### Sudoers Configuration

```
# /etc/sudoers.d/terminar
terminar ALL=(ALL) NOPASSWD: /usr/local/bin/terminar-server --user-mode --socket /run/terminar/*
```

### macOS Support

- Use launchd instead of systemd for the gateway service
- Per-user server spawning via `sudo -u` works the same on macOS
- Plist file in `deploy/` alongside the systemd unit

### Personal Mode (Single-User)

When running without the gateway (current behavior):

- `terminar-server` runs directly as the user
- `--require-auth` flag available to force auth even on Unix socket/loopback
- All hardening from phases 1-3 applies
- No gateway, no sudo, no multi-user

---

## Implementation Order

Bottom-up: each phase is independently valuable and shippable.

1. **Phase 1 — Foundation Hardening** (TLS auto-cert, security headers, SRI, rate limiting)
2. **Phase 2 — Audit Logging** (structured JSON-lines, configurable verbosity)
3. **Phase 3 — Token Lifecycle + Auth Enforcement** (short-lived tokens, refresh rotation, HttpOnly cookies, --require-auth)
4. **Phase 4 — Multi-User Gateway** (gateway binary, per-user servers, sudo spawning, session isolation)
