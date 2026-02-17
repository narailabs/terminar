# Security Features Testing Guide

How to see and test every security feature from the security overhaul.

## Prerequisites

```bash
# Build everything
cd /path/to/terminar
pnpm build          # Builds server (release) + web

# Or build individually:
cd server && cargo build
cd web && pnpm build
```

---

## Phase 1: Foundation Hardening

### 1.1 Auto-TLS (Self-Signed Certificate)

```bash
# Start server with auto-generated TLS cert
cargo run --bin terminar-server -- --no-auth --auto-tls

# Expected output includes:
#   TLS certificate fingerprint: SHA256:AB:CD:...
#   Listening on https://0.0.0.0:8444 (TLS)
```

The cert/key are created at `~/.terminar/tls/cert.pem` and `~/.terminar/tls/key.pem`.

```bash
# Verify the cert exists
ls -la ~/.terminar/tls/

# Inspect the self-signed cert
openssl x509 -in ~/.terminar/tls/cert.pem -text -noout

# Test the TLS endpoint (self-signed, so -k to skip verification)
curl -k https://localhost:8444/health
```

### 1.2 User-Provided TLS Certs

```bash
# Generate your own cert for testing
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
  -keyout /tmp/test-key.pem -out /tmp/test-cert.pem \
  -days 365 -nodes -subj "/CN=localhost"

# Start with your own cert
cargo run --bin terminar-server -- --no-auth --tls-cert /tmp/test-cert.pem --tls-key /tmp/test-key.pem

# Verify it uses your cert
curl -k https://localhost:8444/health
```

### 1.3 HTTP-to-HTTPS Redirect

When TLS is enabled, the HTTP port automatically redirects to HTTPS (except `/health`).

```bash
# Start with auto-TLS
cargo run --bin terminar-server -- --no-auth --auto-tls

# HTTP request should get 307 redirect to HTTPS
curl -v http://localhost:6749/ 2>&1 | grep "< HTTP\|< Location"
# Expected: HTTP/1.1 307 Temporary Redirect
#           Location: https://localhost:8444/

# /health is exempt (for load balancers)
curl http://localhost:6749/health
# Expected: 200 OK
```

### 1.4 Security Headers

All HTTP responses include hardened security headers.

```bash
# Start server (with or without TLS)
cargo run --bin terminar-server -- --no-auth --auto-tls

# Check headers on any endpoint
curl -k -I https://localhost:8444/health

# Expected headers:
#   X-Content-Type-Options: nosniff
#   X-Frame-Options: DENY
#   Content-Security-Policy: default-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'
#   Referrer-Policy: no-referrer
#   Strict-Transport-Security: max-age=31536000  (only when TLS is active)
```

### 1.5 WebSocket Auth Rate Limiting

After 5 failed auth attempts on a WebSocket connection, the server disconnects.

```bash
# Start server WITH auth (--require-auth forces auth on localhost too)
cargo run --bin terminar-server -- --require-auth

# Connect via websocat and send bad auth messages
# (requires websocat: brew install websocat)
websocat -k wss://localhost:8444/ws

# Send 5 bad auth attempts (note: snake_case type tags):
{"type":"auth_password","username":"x","password":"wrong"}
{"type":"auth_password","username":"x","password":"wrong"}
{"type":"auth_password","username":"x","password":"wrong"}
{"type":"auth_password","username":"x","password":"wrong"}
{"type":"auth_password","username":"x","password":"wrong"}

# Connection should be forcibly closed after the 5th attempt
```

### 1.6 Trusted Proxy (X-Forwarded-For)

```bash
# Without --trusted-proxy, X-Forwarded-For is ignored
cargo run --bin terminar-server -- --no-auth

# With --trusted-proxy, only that IP's XFF header is trusted
cargo run --bin terminar-server -- --no-auth --trusted-proxy 10.0.0.1
```

### 1.7 WSS Enforcement (Web Frontend)

Open the web frontend and check the browser console:

```bash
# Start server
pnpm dev

# Open browser to http://localhost:5173
# Connect to a REMOTE server (not localhost)
# Browser console should show:
#   [Security] Upgrading remote connection to WSS: wss://...
```

WSS enforcement only applies to non-localhost connections. Local development (`ws://localhost`) works unchanged.

### 1.8 CDN Asset Removal

The xterm.css file is now bundled locally instead of loaded from cdn.jsdelivr.net.

```bash
# Verify no CDN references in the built HTML
cd web && pnpm build
grep -r "cdn.jsdelivr" dist/
# Expected: no output (no CDN references)

# Verify xterm CSS is in the bundle
grep -l "xterm" dist/assets/*.css
# Expected: the bundled CSS file
```

---

## Phase 2: Audit Logging

> **Important:** Audit events are buffered in memory and flushed to disk on server shutdown
> (graceful SIGTERM). To see audit entries, stop the server after testing, then inspect the log.
> Also note: `--no-auth` skips authentication entirely, so no auth events will be logged.
> Use `--require-auth` to force auth on localhost connections for local testing.

### 2.1 Default Audit Logging (Standard Level)

```bash
# Start server (audit logging is on by default at "standard" level)
cargo run --bin terminar-server -- --require-auth

# Create/close sessions via the web UI, then stop the server (Ctrl+C)
# The audit log is flushed on shutdown:
cat ~/.terminar/audit.log

# Each line is a JSON object like:
# {"timestamp":"2026-02-16T10:30:00Z","event":"session_created","level":"standard",...}
```

### 2.2 Audit Verbosity Levels

```bash
# Off - no logging
cargo run --bin terminar-server -- --no-auth --audit-level off

# Auth only - login success/failure, token revocation
cargo run --bin terminar-server -- --audit-level auth

# Standard (default) - auth + session lifecycle
cargo run --bin terminar-server -- --audit-level standard

# Verbose - everything including connections and reconnections
cargo run --bin terminar-server -- --audit-level verbose
```

### 2.3 Audit Event Types

Connect, authenticate, create sessions, then inspect `~/.terminar/audit.log`:

| Event | Level | When |
|-------|-------|------|
| `auth_success` | auth | Successful login |
| `auth_failure` | auth | Failed login attempt |
| `auth_rate_limited` | auth | Too many failed attempts |
| `token_revoked` | auth | Token revoked (rotation/manual/logout) |
| `session_created` | standard | New terminal session |
| `session_closed` | standard | Session terminated |
| `connection_opened` | verbose | Client connects |
| `connection_closed` | verbose | Client disconnects |
| `token_refreshed` | verbose | Access token refreshed |

```bash
# Pretty-print the audit log
cat ~/.terminar/audit.log | python3 -m json.tool --no-ensure-ascii

# Filter for auth events only
cat ~/.terminar/audit.log | python3 -c "
import sys, json
for line in sys.stdin:
    e = json.loads(line)
    if e.get('level') == 'auth':
        print(json.dumps(e, indent=2))
"
```

---

## Phase 3: Token Lifecycle & Auth Enforcement

### 3.1 Short-Lived Access Tokens (15 minutes)

```bash
# Start server WITH auth
cargo run --bin terminar-server

# Authenticate via the web UI (password or pairing code)
# The access token JWT has a 15-minute expiry (was 24 hours)

# You can decode the JWT to verify:
# Copy the token from the server logs or cookie, then:
echo "<token>" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
# Look for "exp" - should be ~900 seconds after "iat"
```

### 3.2 Refresh Token Rotation

```bash
# Start server with auth
cargo run --bin terminar-server

# After authenticating via the web UI:
# 1. Browser automatically refreshes the token every 14 minutes
# 2. Each refresh issues a new access + refresh token pair
# 3. The old refresh token is revoked

# Check audit log for rotation events:
grep "token_revoked" ~/.terminar/audit.log | grep "rotation"
```

### 3.3 Persistent Token Revocation

Revoked tokens survive server restarts.

```bash
# Start server, authenticate, then stop it
cargo run --bin terminar-server
# (authenticate via web, then Ctrl+C)

# Check the revocation file
cat ~/.terminar/revoked-tokens.jsonl
# Format: {"token_id":"...","revoked_at":"2026-02-16T10:30:00Z","reason":"rotation"}

# Restart the server - revoked tokens are still revoked
cargo run --bin terminar-server
# Previously revoked refresh tokens cannot be reused
```

### 3.4 HttpOnly Cookie Auth (Browser)

```bash
# Start server
cargo run --bin terminar-server

# Open web UI and authenticate
# Open browser DevTools → Application → Cookies

# You should see:
#   terminar_token    (HttpOnly, Secure*, SameSite=Strict, Path=/, Max-Age=900)
#   terminar_refresh  (HttpOnly, Secure*, SameSite=Strict, Path=/auth/refresh, Max-Age=604800)
#
# * Secure flag is set when using HTTPS

# Verify cookies are NOT accessible from JavaScript:
# In browser console:
document.cookie  // Should NOT show terminar_token or terminar_refresh
```

### 3.5 Cookie-Based Session Endpoints

```bash
# After authenticating via the web UI, test the HTTP endpoints:

# Create session cookie (POST /auth/session)
curl -v -X POST http://localhost:6749/auth/session \
  -H "Content-Type: application/json" \
  -d '{"token":"<your-jwt-token>"}' 2>&1 | grep "Set-Cookie"

# Refresh token (POST /auth/refresh) - uses cookie automatically
curl -v -X POST http://localhost:6749/auth/refresh \
  -b "terminar_refresh=<refresh-token>" 2>&1 | grep "Set-Cookie"

# Logout (POST /auth/logout) - clears cookies and revokes refresh token
curl -v -X POST http://localhost:6749/auth/logout \
  -b "terminar_token=<access-token>;terminar_refresh=<refresh-token>" \
  2>&1 | grep "Set-Cookie\|terminar"
# Expected: cookies cleared with Max-Age=0
```

### 3.6 --require-auth Flag

Forces authentication even on local connections (Unix socket and loopback WebSocket).

```bash
# Without --require-auth: loopback WebSocket skips auth
cargo run --bin terminar-server -- --no-auth
# Connect from localhost → no auth needed

# With --require-auth: all connections need auth
cargo run --bin terminar-server -- --require-auth
# Even localhost connections require a valid token
```

### 3.7 VS Code Extension: authToken Setting Removed

The `terminar.authToken` setting has been removed from the extension. Tokens are no longer stored in `settings.json` (which could be accidentally committed to git).

```bash
# Verify the setting is gone from the extension manifest
grep -r "authToken" extension/package.json
# Expected: no output
```

---

## Phase 4: Multi-User Gateway

### 4.1 Build the Gateway Binary

```bash
cd server
cargo build --bin terminar-gateway
# Binary at: target/debug/terminar-gateway
```

### 4.2 Gateway Basic Operation

```bash
# The gateway requires system setup (sudo, socket directory, etc.)
# For local testing, start it with minimal config:

# Create socket directory
sudo mkdir -p /run/terminar
sudo chown $USER /run/terminar

# Start gateway (it listens for WebSocket connections and proxies to per-user servers)
cargo run --bin terminar-gateway -- --port 4000 --socket-dir /tmp/terminar-test --server-bin ./target/debug/terminar-server

# Expected output:
#   termiNar gateway listening on 0.0.0.0:4000
#   Socket dir: /tmp/terminar-test
```

### 4.3 Gateway Auto-TLS

```bash
# Gateway enables auto-TLS by default (unlike the main server)
cargo run --bin terminar-gateway

# Disable with --no-auto-tls
cargo run --bin terminar-gateway -- --no-auto-tls
```

### 4.4 Per-User Server Mode

```bash
# The --user-mode flag is used by the gateway when spawning per-user servers
# It skips auth (gateway already authenticated) and refuses to run as root

# Test user-mode directly:
cargo run --bin terminar-server -- --user-mode --socket /tmp/terminar-test/myuser.sock

# Verify it refuses to run as root:
sudo cargo run --bin terminar-server -- --user-mode
# Expected: error - refuses to run as root in user-mode
```

### 4.5 Username Validation

The gateway validates usernames before constructing paths or commands:

```bash
# These usernames are rejected:
# - Empty strings
# - Containing / or \ or null bytes
# - Starting with . or -
# - Longer than 32 characters
# This prevents path traversal attacks via crafted usernames
```

### 4.6 Idle Server Shutdown

```bash
# Gateway shuts down idle per-user servers after 30 minutes (default)
# Customize with --idle-timeout:
cargo run --bin terminar-gateway -- --idle-timeout 60  # 1 minute for testing
```

### 4.7 Deployment Files

Review the deployment configurations:

```bash
# Systemd service for the gateway
cat deploy/terminar-gateway.service

# macOS launchd plist
cat deploy/com.terminar.gateway.plist

# Sudoers fragment (for per-user server spawning)
cat deploy/terminar-sudoers
```

---

## Quick Smoke Test

Run this sequence to quickly verify the core security features work:

```bash
# 1. Build
cd server && cargo build

# 2. Start with auto-TLS, verbose audit, and forced auth on localhost
cargo run --bin terminar-server -- --require-auth --auto-tls --audit-level verbose

# 3. Verify TLS
curl -k https://localhost:8444/health
# → {"status":"ok",...}

# 4. Check security headers
curl -k -I https://localhost:8444/health 2>&1 | grep -E "X-Content-Type|X-Frame|Content-Security|Referrer|Strict-Transport"

# 5. Check HTTP→HTTPS redirect
curl -v http://localhost:6749/ 2>&1 | grep "307\|308\|Location"

# 6. Open web UI, authenticate, check cookies in DevTools

# 7. Stop server (Ctrl+C) to flush audit log, then check it
cat ~/.terminar/audit.log | python3 -m json.tool

# 8. Check revocation persistence
cat ~/.terminar/revoked-tokens.jsonl

# 9. Restart, verify revoked tokens are still revoked
```

---

## Automated Tests

All security features have unit tests:

```bash
# Run all server tests (includes security module tests)
cd server && cargo test

# Run specific security module tests:
cargo test audit          # Audit logging tests
cargo test revocation     # Token revocation tests
cargo test cookies        # Cookie helper tests
cargo test security       # Security headers tests
cargo test tls            # TLS tests
cargo test gateway        # Gateway tests
cargo test rate_limit     # Rate limiting tests

# Run web frontend tests (WSS enforcement, cookie auth, etc.)
cd web && pnpm test -- --run

# Run protocol tests
cd packages/shell-protocol && pnpm test -- --run
```
