# Security Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden terminar for remote access and multi-user deployment across four incremental phases.

**Architecture:** Bottom-up hardening — each phase is independently shippable. Phase 1 hardens TLS/headers/rate-limiting, Phase 2 adds audit logging, Phase 3 overhauls token lifecycle and auth enforcement, Phase 4 adds the multi-user gateway with per-user server isolation.

**Tech Stack:** Rust (axum, rustls, ring, jsonwebtoken, rcgen), TypeScript (Svelte, xterm.js, Zod), shell-protocol shared package.

**Design Doc:** `docs/plans/2026-02-16-security-overhaul-design.md`

---

## Phase 1: Foundation Hardening

### Task 1: Auto-generate TLS cert on startup

**Files:**
- Modify: `server/src/lib.rs` (startup sequence, ~line 389-534)
- Modify: `server/src/tls.rs` (reuse `ensure_tls_cert()`, ~line 197)
- Modify: `server/src/config.rs` (add `--auto-tls` flag)
- Test: `server/src/tls.rs` (existing tests + new)

**Step 1: Write failing test for auto-TLS config resolution**

In `server/src/tls.rs`, add a test that verifies: when `--auto-tls` is true and no cert/key flags are set, `resolve_tls_config()` returns a config pointing to `~/.terminar/tls/`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_resolve_tls_auto_generates_cert() {
        let tmp = TempDir::new().unwrap();
        let tls_dir = tmp.path().join("tls");
        let result = resolve_tls_config(None, None, 8444, true, &tls_dir).unwrap();
        assert!(result.is_some());
        let config = result.unwrap();
        assert!(config.cert_path.ends_with("cert.pem"));
        assert!(config.key_path.ends_with("key.pem"));
        assert_eq!(config.port, 8444);
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && cargo test test_resolve_tls_auto_generates_cert -- --nocapture`
Expected: FAIL — `resolve_tls_config` doesn't exist yet.

**Step 3: Add `--auto-tls` CLI flag**

In `server/src/config.rs`, add to the `Cli` struct:

```rust
/// Auto-generate self-signed TLS certificate on startup
#[arg(long, default_value_t = false)]
pub auto_tls: bool,
```

**Step 4: Implement `resolve_tls_config()`**

In `server/src/tls.rs`, add a function that resolves TLS config from CLI args:

```rust
/// Resolve TLS configuration from CLI flags.
/// Priority: explicit --tls-cert/--tls-key > --auto-tls > none.
pub fn resolve_tls_config(
    tls_cert: Option<&str>,
    tls_key: Option<&str>,
    tls_port: u16,
    auto_tls: bool,
    tls_dir: &Path,
) -> Result<Option<TlsConfig>, TlsError> {
    // If explicit cert/key provided, use validate_tls_config (existing)
    if tls_cert.is_some() || tls_key.is_some() {
        return validate_tls_config(
            tls_cert.map(|s| s.to_string()),
            tls_key.map(|s| s.to_string()),
            tls_port,
        );
    }
    // If auto-tls, generate/load cert
    if auto_tls {
        let generated = ensure_tls_cert(tls_dir)?;
        return Ok(Some(TlsConfig {
            cert_path: generated.cert_path,
            key_path: generated.key_path,
            port: tls_port,
        }));
    }
    Ok(None)
}
```

**Step 5: Run test to verify it passes**

Run: `cd server && cargo test test_resolve_tls_auto_generates_cert -- --nocapture`
Expected: PASS

**Step 6: Wire into server startup**

In `server/src/lib.rs`, replace the existing `validate_tls_config()` call in the startup sequence with `resolve_tls_config()`, passing `cli.auto_tls` and the `~/.terminar/tls/` path.

**Step 7: Run full test suite**

Run: `cd server && cargo test`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add server/src/config.rs server/src/tls.rs server/src/lib.rs
git commit -m "feat(server): auto-generate TLS cert on startup with --auto-tls flag"
```

---

### Task 2: Log TLS fingerprint on startup for TOFU

**Files:**
- Modify: `server/src/lib.rs` (after TLS config resolved, ~line 500)
- Modify: `server/src/tls.rs` (`compute_cert_fingerprint` already exists at ~line 176)

**Step 1: Write test for fingerprint display format**

In `server/src/tls.rs`, add a test that generates a cert and computes its fingerprint:

```rust
#[test]
fn test_cert_fingerprint_format() {
    let tmp = TempDir::new().unwrap();
    let generated = generate_self_signed_cert(tmp.path()).unwrap();
    let cert_bytes = std::fs::read(&generated.cert_path).unwrap();
    let fingerprint = compute_cert_fingerprint(&cert_bytes).unwrap();
    // SHA-256 fingerprint = 32 bytes = 64 hex chars + 31 colons = 95 chars
    assert_eq!(fingerprint.len(), 95);
    assert!(fingerprint.contains(':'));
}
```

**Step 2: Run test**

Run: `cd server && cargo test test_cert_fingerprint_format -- --nocapture`
Expected: PASS (this tests existing functionality).

**Step 3: Add fingerprint logging to startup**

In `server/src/lib.rs`, after TLS config is resolved and cert is loaded, log the fingerprint at `info!` level:

```rust
if let Some(ref tls_config) = tls_config {
    let cert_bytes = std::fs::read(&tls_config.cert_path)
        .map_err(|e| format!("Failed to read TLS cert: {}", e))?;
    let fingerprint = tls::compute_cert_fingerprint(&cert_bytes)
        .map_err(|e| format!("Failed to compute fingerprint: {:?}", e))?;
    info!("TLS certificate fingerprint (SHA-256): {}", fingerprint);
    info!("Verify this fingerprint on first connection (TOFU)");
}
```

**Step 4: Run full test suite**

Run: `cd server && cargo test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add server/src/lib.rs server/src/tls.rs
git commit -m "feat(server): log TLS cert fingerprint on startup for TOFU verification"
```

---

### Task 3: Add security response headers

**Files:**
- Create: `server/src/security_headers.rs`
- Modify: `server/src/lib.rs` (add middleware to router, ~line 539-552)
- Modify: `server/src/main.rs` (add `mod security_headers;` if needed)

**Step 1: Write failing test for security headers middleware**

In `server/src/security_headers.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::get, Router};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_security_headers_added() {
        let app = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(security_headers_layer(false));

        let response = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.headers().get("X-Content-Type-Options").unwrap(),
            "nosniff"
        );
        assert_eq!(
            response.headers().get("X-Frame-Options").unwrap(),
            "DENY"
        );
        assert_eq!(
            response.headers().get("Referrer-Policy").unwrap(),
            "no-referrer"
        );
        // HSTS should NOT be set when tls_enabled=false
        assert!(response.headers().get("Strict-Transport-Security").is_none());
    }

    #[tokio::test]
    async fn test_hsts_when_tls_enabled() {
        let app = Router::new()
            .route("/test", get(|| async { "ok" }))
            .layer(security_headers_layer(true));

        let response = app
            .oneshot(Request::builder().uri("/test").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(
            response.headers().get("Strict-Transport-Security").unwrap(),
            "max-age=31536000"
        );
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && cargo test test_security_headers -- --nocapture`
Expected: FAIL — module doesn't exist.

**Step 3: Implement security headers middleware**

Create `server/src/security_headers.rs`:

```rust
use axum::http::{HeaderName, HeaderValue};
use tower_http::set_header::SetResponseHeaderLayer;
use tower::layer::util::Stack;

pub fn security_headers_layer(tls_enabled: bool) -> impl tower::Layer<...> + Clone {
    // Use axum middleware::from_fn pattern instead:
    // Return a middleware that sets headers on every response
}
```

Use `axum::middleware::from_fn` with a closure that inserts headers into every response. This is simpler than stacking multiple `SetResponseHeaderLayer`s:

```rust
use axum::{
    http::{Request, Response, HeaderValue},
    middleware::Next,
};

pub async fn security_headers_middleware(
    req: Request<axum::body::Body>,
    next: Next,
) -> Response<axum::body::Body> {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
    headers.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    headers.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "Content-Security-Policy",
        HeaderValue::from_static("default-src 'self'; connect-src 'self' wss:; style-src 'self' 'unsafe-inline'"),
    );
    response
}
```

For HSTS (conditional on TLS), store `tls_enabled` in a shared state or use `axum::middleware::from_fn_with_state`.

**Step 4: Run test to verify it passes**

Run: `cd server && cargo test test_security_headers -- --nocapture`
Expected: PASS

**Step 5: Wire into server router**

In `server/src/lib.rs`, add the security headers middleware to the router, passing `tls_config.is_some()` for the HSTS conditional.

**Step 6: Run full test suite**

Run: `cd server && cargo test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add server/src/security_headers.rs server/src/lib.rs
git commit -m "feat(server): add security response headers (X-Content-Type-Options, X-Frame-Options, CSP, HSTS)"
```

---

### Task 4: Bundle xterm.css (remove CDN dependency)

**Files:**
- Modify: `web/index.html` (remove CDN `<link>`, ~line 7)
- Modify: `web/src/main.ts` or `web/src/app.css` (import xterm CSS)

**Step 1: Check xterm is installed locally**

Run: `ls web/node_modules/xterm/css/xterm.css`
Expected: File exists (xterm is a dependency).

**Step 2: Remove CDN link from index.html**

In `web/index.html`, remove the line:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
```

**Step 3: Import xterm CSS in the app**

In `web/src/main.ts` (or wherever the app entry point imports global styles), add:
```typescript
import 'xterm/css/xterm.css';
```

Vite will bundle this CSS automatically.

**Step 4: Test that the web app still renders terminals correctly**

Run: `cd web && pnpm build`
Expected: Build succeeds with xterm CSS bundled.

**Step 5: Commit**

```bash
git add web/index.html web/src/main.ts
git commit -m "fix(web): bundle xterm.css locally instead of loading from CDN"
```

---

### Task 5: Rate-limit WebSocket password auth attempts

**Files:**
- Modify: `server/src/lib.rs` (WebSocket auth handler, ~lines 1095-1302)

**Step 1: Write failing test**

Add a test in `server/src/lib.rs` (or a test module) that verifies: after 5 failed password auth attempts on a single WebSocket connection, the server sends an error with `RATE_LIMIT_EXCEEDED` and closes the connection.

```rust
#[tokio::test]
async fn test_ws_auth_rate_limit_after_5_failures() {
    // Setup: create a mock WebSocket connection
    // Send 5 auth_password messages with wrong password
    // Verify 5th attempt returns Error with RATE_LIMIT_EXCEEDED
    // Verify connection is closed
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && cargo test test_ws_auth_rate_limit -- --nocapture`
Expected: FAIL — no rate limiting on WebSocket auth.

**Step 3: Add per-connection auth attempt counter**

In the WebSocket handler (`handle_websocket` in `lib.rs`), add a local counter before the auth loop:

```rust
let mut auth_attempts: usize = 0;
const MAX_WS_AUTH_ATTEMPTS: usize = 5;
```

In the auth message handling block, before processing any auth message, increment and check:

```rust
auth_attempts += 1;
if auth_attempts > MAX_WS_AUTH_ATTEMPTS {
    let error_msg = ServerMessage::Error {
        message: "Too many authentication attempts".to_string(),
        error_code: Some("RATE_LIMIT_EXCEEDED".to_string()),
    };
    let _ = sender.send(Message::Text(serde_json::to_string(&error_msg).unwrap())).await;
    break; // Close connection
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && cargo test test_ws_auth_rate_limit -- --nocapture`
Expected: PASS

**Step 5: Run full test suite**

Run: `cd server && cargo test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add server/src/lib.rs
git commit -m "fix(server): rate-limit WebSocket auth to 5 attempts per connection"
```

---

### Task 6: Add `--trusted-proxy` flag for X-Forwarded-For

**Files:**
- Modify: `server/src/config.rs` (add flag)
- Modify: `server/src/lib.rs` (pairing exchange handler, ~line 825-897)
- Modify: `server/src/constants.rs` (add constant if needed)

**Step 1: Add CLI flag**

In `server/src/config.rs`:

```rust
/// Trusted proxy IP for X-Forwarded-For header (only trust XFF from this IP)
#[arg(long)]
pub trusted_proxy: Option<String>,
```

**Step 2: Create helper to extract client IP safely**

In `server/src/lib.rs`, add a helper:

```rust
fn extract_client_ip(req: &Request, trusted_proxy: Option<&str>, peer_ip: Option<&str>) -> String {
    if let Some(proxy_ip) = trusted_proxy {
        if peer_ip == Some(proxy_ip) {
            // Only trust X-Forwarded-For if request came from the trusted proxy
            if let Some(xff) = req.headers().get("X-Forwarded-For") {
                if let Ok(xff_str) = xff.to_str() {
                    // Take the first (leftmost) IP — the original client
                    if let Some(client_ip) = xff_str.split(',').next() {
                        return client_ip.trim().to_string();
                    }
                }
            }
        }
    }
    // Fallback to peer IP
    peer_ip.unwrap_or("unknown").to_string()
}
```

**Step 3: Write test for IP extraction**

```rust
#[test]
fn test_extract_client_ip_trusted_proxy() {
    // When trusted_proxy matches peer_ip, use X-Forwarded-For
    // When trusted_proxy doesn't match, use peer_ip
    // When no trusted_proxy configured, use peer_ip
}
```

**Step 4: Run test, implement, verify**

Run: `cd server && cargo test test_extract_client_ip -- --nocapture`

**Step 5: Update exchange_handler to use `extract_client_ip()`**

Replace the raw `X-Forwarded-For` header reading in the `exchange_handler` with the new helper.

**Step 6: Wire `trusted_proxy` through AppState**

Add `trusted_proxy: Option<String>` to `AppState` and pass from CLI config.

**Step 7: Run full test suite**

Run: `cd server && cargo test`
Expected: All tests pass.

**Step 8: Commit**

```bash
git add server/src/config.rs server/src/lib.rs
git commit -m "feat(server): add --trusted-proxy flag for safe X-Forwarded-For handling"
```

---

### Task 7: Enforce WSS for remote connections (web client)

**Files:**
- Modify: `web/src/App.svelte` (connection logic, ~line 426)
- Modify: `web/src/lib/WebSocketSessionManager.ts` (constructor)

**Step 1: Add WSS enforcement in App.svelte**

In the connection functions (`connect()`, `connectWithPassword()`, `connectWithSshKey()`), before creating the WebSocketSessionManager, add a check:

```typescript
function enforceSecureConnection(url: string): string {
    if (!isLocalServer(url) && url.startsWith('ws://')) {
        // Upgrade ws:// to wss:// for remote connections
        const secureUrl = url.replace('ws://', 'wss://');
        console.warn(`[Security] Upgrading remote connection to WSS: ${secureUrl}`);
        return secureUrl;
    }
    return url;
}
```

Call this on `wsUrl` before passing to `WebSocketSessionManager`.

**Step 2: Update extension remote connection**

In `extension/src/extension.ts` (~line 104), change:
```typescript
const wsUrl = `ws://${host}/ws`;
```
to:
```typescript
const wsUrl = `wss://${host}/ws`;
```

**Step 3: Test the web build**

Run: `cd web && pnpm build`
Expected: Build succeeds.

**Step 4: Run web tests**

Run: `cd web && pnpm test -- --run`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add web/src/App.svelte extension/src/extension.ts
git commit -m "feat: enforce WSS for remote WebSocket connections"
```

---

### Task 8: HTTP-to-HTTPS redirect when TLS is configured

**Files:**
- Modify: `server/src/lib.rs` (HTTP listener setup, ~line 570)

**Step 1: Write test**

```rust
#[tokio::test]
async fn test_http_redirect_to_https() {
    // When TLS is configured, HTTP requests should get 301 redirect to HTTPS
}
```

**Step 2: Implement redirect**

When TLS is configured, instead of sharing the same router on the HTTP port, use a simple redirect router:

```rust
if tls_config.is_some() {
    let redirect_app = Router::new().fallback(|req: Request<Body>| async move {
        let host = req.headers().get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("localhost");
        let uri = req.uri();
        let redirect_url = format!("https://{}{}", host, uri);
        Redirect::permanent(&redirect_url)
    });
    // Bind HTTP listener with redirect_app instead of main app
}
```

**Step 3: Run tests and commit**

Run: `cd server && cargo test`

```bash
git add server/src/lib.rs
git commit -m "feat(server): redirect HTTP to HTTPS when TLS is configured"
```

---

## Phase 2: Audit Logging

### Task 9: Create audit logger module with event types

**Files:**
- Create: `server/src/audit.rs`
- Modify: `server/src/config.rs` (add `--audit-level` flag)

**Step 1: Write failing test for audit event serialization**

In `server/src/audit.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_event_serializes_to_json() {
        let event = AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::AuthSuccess,
            level: AuditLevel::Auth,
            username: Some("narayan".to_string()),
            method: Some("ssh_pubkey".to_string()),
            client_ip: Some("192.168.1.50".to_string()),
            connection_type: Some("websocket".to_string()),
            details: serde_json::json!({}),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("auth_success"));
        assert!(json.contains("narayan"));
    }

    #[test]
    fn test_audit_level_filtering() {
        assert!(AuditLevel::Auth.should_log(&AuditLevel::Auth));
        assert!(AuditLevel::Auth.should_log(&AuditLevel::Standard));
        assert!(AuditLevel::Auth.should_log(&AuditLevel::Verbose));
        assert!(!AuditLevel::Standard.should_log(&AuditLevel::Auth));
        assert!(AuditLevel::Standard.should_log(&AuditLevel::Standard));
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && cargo test test_audit_event -- --nocapture`
Expected: FAIL

**Step 3: Implement audit types**

```rust
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, PartialOrd)]
#[serde(rename_all = "snake_case")]
pub enum AuditLevel {
    Off,
    Auth,
    Standard,
    Verbose,
}

impl AuditLevel {
    /// Returns true if `event_level` should be logged when the logger is configured at `self`.
    pub fn should_log(&self, event_level: &AuditLevel) -> bool {
        // Off logs nothing, otherwise: Auth ⊂ Standard ⊂ Verbose
        match self {
            AuditLevel::Off => false,
            _ => event_level <= self,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    AuthSuccess,
    AuthFailure,
    AuthRateLimited,
    TokenRevoked,
    SessionCreated,
    SessionAttached,
    SessionDetached,
    SessionClosed,
    PairingCodeGenerated,
    PairingCodeUsed,
    ServerConfigChanged,
    ConnectionOpened,
    ConnectionClosed,
    ReconnectionAttempt,
    TokenRefreshed,
}

impl AuditEventType {
    pub fn level(&self) -> AuditLevel {
        match self {
            Self::AuthSuccess | Self::AuthFailure | Self::AuthRateLimited | Self::TokenRevoked
                => AuditLevel::Auth,
            Self::SessionCreated | Self::SessionAttached | Self::SessionDetached
            | Self::SessionClosed | Self::PairingCodeGenerated | Self::PairingCodeUsed
            | Self::ServerConfigChanged
                => AuditLevel::Standard,
            Self::ConnectionOpened | Self::ConnectionClosed | Self::ReconnectionAttempt
            | Self::TokenRefreshed
                => AuditLevel::Verbose,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditEvent {
    pub timestamp: String,
    pub event: AuditEventType,
    pub level: AuditLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub details: serde_json::Value,
}
```

**Step 4: Add `--audit-level` flag to config**

In `server/src/config.rs`:

```rust
/// Audit log verbosity level: off, auth, standard, verbose
#[arg(long, default_value = "standard")]
pub audit_level: String,
```

**Step 5: Run tests to verify they pass**

Run: `cd server && cargo test test_audit -- --nocapture`
Expected: PASS

**Step 6: Commit**

```bash
git add server/src/audit.rs server/src/config.rs
git commit -m "feat(server): add audit event types and level filtering"
```

---

### Task 10: Implement AuditLogger with async file writes

**Files:**
- Modify: `server/src/audit.rs`

**Step 1: Write failing test for AuditLogger file output**

```rust
#[tokio::test]
async fn test_audit_logger_writes_to_file() {
    let tmp = TempDir::new().unwrap();
    let log_path = tmp.path().join("audit.log");
    let logger = AuditLogger::new(log_path.clone(), AuditLevel::Verbose).await.unwrap();

    logger.log(AuditEvent {
        timestamp: "2026-02-16T10:30:00Z".to_string(),
        event: AuditEventType::AuthSuccess,
        level: AuditLevel::Auth,
        username: Some("test".to_string()),
        ..Default::default()
    }).await;

    logger.flush().await;

    let contents = std::fs::read_to_string(&log_path).unwrap();
    assert!(contents.contains("auth_success"));
    assert!(contents.contains("test"));
}

#[tokio::test]
async fn test_audit_logger_respects_level_filter() {
    let tmp = TempDir::new().unwrap();
    let log_path = tmp.path().join("audit.log");
    let logger = AuditLogger::new(log_path.clone(), AuditLevel::Auth).await.unwrap();

    // This is a "verbose" level event — should NOT be logged at "auth" level
    logger.log(AuditEvent {
        timestamp: "2026-02-16T10:30:00Z".to_string(),
        event: AuditEventType::ConnectionOpened,
        level: AuditLevel::Verbose,
        ..Default::default()
    }).await;

    logger.flush().await;

    let contents = std::fs::read_to_string(&log_path).unwrap_or_default();
    assert!(!contents.contains("connection_opened"));
}
```

**Step 2: Run test to verify it fails**

Run: `cd server && cargo test test_audit_logger -- --nocapture`
Expected: FAIL — `AuditLogger` doesn't exist.

**Step 3: Implement AuditLogger**

```rust
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

pub struct AuditLogger {
    sender: mpsc::UnboundedSender<AuditEvent>,
    flush_tx: mpsc::Sender<tokio::sync::oneshot::Sender<()>>,
}

impl AuditLogger {
    pub async fn new(path: PathBuf, level: AuditLevel) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;

        let (sender, mut receiver) = mpsc::unbounded_channel::<AuditEvent>();
        let (flush_tx, mut flush_rx) = mpsc::channel::<tokio::sync::oneshot::Sender<()>>(1);

        tokio::spawn(async move {
            let mut writer = tokio::io::BufWriter::new(file);
            loop {
                tokio::select! {
                    Some(event) = receiver.recv() => {
                        if level.should_log(&event.event.level()) {
                            if let Ok(json) = serde_json::to_string(&event) {
                                let _ = writer.write_all(json.as_bytes()).await;
                                let _ = writer.write_all(b"\n").await;
                            }
                        }
                    }
                    Some(done) = flush_rx.recv() => {
                        let _ = writer.flush().await;
                        let _ = done.send(());
                    }
                    else => break,
                }
            }
        });

        Ok(Self { sender, flush_tx })
    }

    pub async fn log(&self, event: AuditEvent) {
        let _ = self.sender.send(event);
    }

    pub async fn flush(&self) {
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let _ = self.flush_tx.send(done_tx).await;
        let _ = done_rx.await;
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && cargo test test_audit_logger -- --nocapture`
Expected: PASS

**Step 5: Commit**

```bash
git add server/src/audit.rs
git commit -m "feat(server): implement AuditLogger with async buffered file writes"
```

---

### Task 11: Wire audit logger into server and add audit calls

**Files:**
- Modify: `server/src/lib.rs` (AppState, startup, auth handler, session handlers)
- Modify: `server/src/audit.rs` (helper constructors for common events)

**Step 1: Add AuditLogger to AppState**

In `server/src/lib.rs`, add to `AppState`:

```rust
pub audit_logger: Option<Arc<AuditLogger>>,
```

**Step 2: Initialize AuditLogger at startup**

In the startup sequence, after parsing `--audit-level`:

```rust
let audit_logger = if audit_level != AuditLevel::Off {
    let audit_path = home_dir.join(".terminar").join("audit.log");
    Some(Arc::new(AuditLogger::new(audit_path, audit_level).await?))
} else {
    None
};
```

**Step 3: Add audit helper methods**

In `server/src/audit.rs`, add convenience constructors:

```rust
impl AuditEvent {
    pub fn auth_success(username: &str, method: &str, client_ip: &str, conn_type: &str) -> Self { ... }
    pub fn auth_failure(username: Option<&str>, method: &str, client_ip: &str, reason: &str) -> Self { ... }
    pub fn session_created(session_id: &str, username: &str, shell: &str) -> Self { ... }
    pub fn session_closed(session_id: &str, username: &str, reason: &str) -> Self { ... }
    // ... etc
}
```

**Step 4: Add audit calls at auth success/failure points**

In the WebSocket handler (`handle_websocket`), after each successful or failed auth:

```rust
if let Some(ref logger) = state.audit_logger {
    logger.log(AuditEvent::auth_success(&username, "password", &client_ip, "websocket")).await;
}
```

Similarly for session creation, attachment, close, pairing, etc.

**Step 5: Flush audit log on shutdown**

In the shutdown handler, call `audit_logger.flush().await` before exit.

**Step 6: Run full test suite**

Run: `cd server && cargo test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add server/src/lib.rs server/src/audit.rs
git commit -m "feat(server): wire audit logger into auth, session, and connection events"
```

---

### Task 12: Add logrotate config for audit.log

**Files:**
- Modify: `deploy/logrotate.conf` (or create if it doesn't exist)

**Step 1: Check existing logrotate config**

Run: `ls deploy/`
Check for existing logrotate configuration.

**Step 2: Add audit.log rotation**

```
/home/*/.terminar/audit.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

**Step 3: Commit**

```bash
git add deploy/
git commit -m "feat(deploy): add logrotate config for audit.log"
```

---

## Phase 3: Token Lifecycle + Auth Enforcement

### Task 13: Reduce access token expiry to 15 minutes

**Files:**
- Modify: `server/src/lib.rs` (token issuance in WebSocket handler, ~line 1119)
- Modify: `server/src/constants.rs` (add constant)

**Step 1: Add constant**

In `server/src/constants.rs`:

```rust
/// Access token lifetime: 15 minutes
pub const ACCESS_TOKEN_EXPIRY_SECS: u64 = 15 * 60;

/// Refresh token lifetime: 7 days
pub const REFRESH_TOKEN_EXPIRY_SECS: u64 = 7 * 24 * 60 * 60;
```

**Step 2: Update token issuance**

In `server/src/lib.rs`, replace all hardcoded `Duration::from_secs(86400)` (24h) with `Duration::from_secs(ACCESS_TOKEN_EXPIRY_SECS)` for access tokens. The refresh handler already uses 15min/7day values — verify these match the constants.

**Step 3: Update WebSocket auth to issue both access + refresh tokens**

After successful auth (password, SSH, or pairing), issue both tokens and return them in `AuthOk`. The `AuthOk` message currently returns a single token. We need to add `refresh_token` to the `AuthOk` server message.

In `packages/shell-protocol/src/messages.ts`, update `AuthOk`:

```typescript
z.object({
    type: z.literal('AuthOk'),
    token: z.string(),
    expires: z.string(),
    refresh_token: z.string().optional(),
    protocol_version: z.string().optional(),
})
```

And in the Rust server message type, add `refresh_token: Option<String>` to the `AuthOk` variant.

**Step 4: Run tests across server and protocol package**

Run: `cd server && cargo test`
Run: `cd packages/shell-protocol && pnpm test -- --run`
Expected: All pass.

**Step 5: Commit**

```bash
git add server/src/lib.rs server/src/constants.rs packages/shell-protocol/src/messages.ts
git commit -m "feat: reduce access token to 15-minute expiry, issue refresh tokens on auth"
```

---

### Task 14: Implement refresh token rotation with revocation

**Files:**
- Modify: `server/src/lib.rs` (refresh handler, ~line 909-952)
- Modify: `server/src/jwt.rs` (add `jti` claim for token ID)

**Step 1: Add `jti` (JWT ID) claim**

In `server/src/jwt.rs`, add `jti: String` to the `Claims` struct and generate a UUID for each issued token. This gives each token a unique ID for revocation tracking.

```rust
pub struct Claims {
    pub sub: String,
    pub server_id: String,
    pub iat: u64,
    pub exp: u64,
    pub token_type: String,
    pub jti: String,  // New: unique token ID
}
```

Update `issue_token`, `issue_access_token`, `issue_refresh_token` to generate `jti: Uuid::new_v4().to_string()`.

**Step 2: Write test for refresh rotation**

```rust
#[tokio::test]
async fn test_refresh_rotation_revokes_old_token() {
    // Issue refresh token
    // Call refresh endpoint
    // Verify old refresh token is now in revoked set
    // Verify new access + refresh tokens are returned
    // Verify old refresh token cannot be used again
}
```

**Step 3: Update refresh handler to revoke old refresh token**

In `refresh_handler`, after validating the old refresh token:
1. Add old token to `revoked_tokens`
2. Issue new access token (15 min)
3. Issue new refresh token (7 days)
4. Return both

**Step 4: Run tests**

Run: `cd server && cargo test`
Expected: All pass.

**Step 5: Commit**

```bash
git add server/src/jwt.rs server/src/lib.rs
git commit -m "feat(server): add JWT ID (jti) claim and refresh token rotation with revocation"
```

---

### Task 15: Persist revoked tokens to disk

**Files:**
- Create: `server/src/revocation.rs`
- Modify: `server/src/lib.rs` (startup + shutdown + revoke handler)

**Step 1: Write failing test**

```rust
#[tokio::test]
async fn test_revocation_persistence_roundtrip() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("revoked-tokens.jsonl");

    let store = RevocationStore::new(path.clone()).await.unwrap();
    store.revoke("token-123", "rotation").await;
    store.flush().await;

    // Reload from disk
    let store2 = RevocationStore::new(path).await.unwrap();
    assert!(store2.is_revoked("token-123"));
}

#[test]
fn test_prune_expired_tokens() {
    // Create entries with expired timestamps
    // Load → expired entries should be pruned
}
```

**Step 2: Implement RevocationStore**

```rust
pub struct RevocationStore {
    revoked: Arc<Mutex<HashSet<String>>>,
    path: PathBuf,
    writer: mpsc::UnboundedSender<RevocationEntry>,
}

#[derive(Serialize, Deserialize)]
struct RevocationEntry {
    token_id: String,
    revoked_at: String,
    reason: String,
    exp: Option<u64>,  // Token's expiry, for pruning
}

impl RevocationStore {
    pub async fn new(path: PathBuf) -> std::io::Result<Self> { ... }
    pub async fn revoke(&self, token_id: &str, reason: &str) { ... }
    pub fn is_revoked(&self, token_id: &str) -> bool { ... }
    pub async fn flush(&self) { ... }
}
```

On load, read JSONL file, skip entries where `exp < now`, populate `HashSet`.

**Step 3: Run tests**

Run: `cd server && cargo test test_revocation -- --nocapture`
Expected: PASS

**Step 4: Replace in-memory `revoked_tokens` HashSet in AppState with RevocationStore**

**Step 5: Run full tests and commit**

```bash
git add server/src/revocation.rs server/src/lib.rs
git commit -m "feat(server): persist revoked tokens to disk with auto-pruning on startup"
```

---

### Task 16: Add HttpOnly cookie support for browser auth

**Files:**
- Create: `server/src/cookies.rs` (cookie helpers)
- Modify: `server/src/lib.rs` (new `/auth/session` and `/auth/logout` endpoints)
- Modify: `web/src/App.svelte` (switch from localStorage to cookie-based auth)
- Modify: `web/src/lib/tokenStore.ts` (remove or repurpose)

**Step 1: Implement cookie helpers on the server**

In `server/src/cookies.rs`:

```rust
use axum::http::{HeaderValue, header::SET_COOKIE};

pub fn set_auth_cookies(access_token: &str, refresh_token: &str, secure: bool) -> Vec<(String, String)> {
    let secure_flag = if secure { "; Secure" } else { "" };
    vec![
        ("Set-Cookie".to_string(), format!(
            "terminar_token={}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900{}",
            access_token, secure_flag
        )),
        ("Set-Cookie".to_string(), format!(
            "terminar_refresh={}; HttpOnly; SameSite=Strict; Path=/auth/refresh; Max-Age=604800{}",
            refresh_token, secure_flag
        )),
    ]
}

pub fn clear_auth_cookies() -> Vec<(String, String)> {
    vec![
        ("Set-Cookie".to_string(), "terminar_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0".to_string()),
        ("Set-Cookie".to_string(), "terminar_refresh=; HttpOnly; SameSite=Strict; Path=/auth/refresh; Max-Age=0".to_string()),
    ]
}

pub fn extract_cookie(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers.get("Cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';')
                .map(|s| s.trim())
                .find(|s| s.starts_with(&format!("{}=", name)))
                .map(|s| s[name.len() + 1..].to_string())
        })
}
```

**Step 2: Add `/auth/session` endpoint**

POST endpoint that accepts `{ "token": "..." }` or reads from existing auth, then sets cookies:

```rust
async fn session_handler(State(state): State<AppState>, Json(payload): Json<SessionRequest>) -> impl IntoResponse {
    // Validate the token
    // Issue access + refresh tokens
    // Return response with Set-Cookie headers
}
```

**Step 3: Add `/auth/logout` endpoint**

POST endpoint that clears cookies and revokes refresh token:

```rust
async fn logout_handler(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    // Extract refresh token from cookie
    // Revoke it
    // Return response with cleared cookies
}
```

**Step 4: Update WebSocket upgrade to read token from cookie**

In the WebSocket handler, before the auth loop, check for a `terminar_token` cookie. If present and valid, skip message-based auth.

**Step 5: Update web client**

In `web/src/App.svelte`:
- After successful auth, call `POST /auth/session` to set cookies
- On page load, attempt WebSocket connection (cookies sent automatically on upgrade)
- On logout, call `POST /auth/logout`
- Remove `saveToken()`/`loadToken()` calls (cookies are automatic)

In `web/src/lib/tokenStore.ts`:
- Keep for backward compatibility but mark as deprecated
- New auth flow uses cookies instead

**Step 6: Update refresh flow**

In `web/src/App.svelte`, add a periodic refresh:

```typescript
// Every 14 minutes, refresh the access token
setInterval(async () => {
    await fetch(`${httpUrl}/auth/refresh`, { method: 'POST', credentials: 'include' });
}, 14 * 60 * 1000);
```

**Step 7: Run tests across server and web**

Run: `cd server && cargo test`
Run: `cd web && pnpm test -- --run`
Expected: All pass.

**Step 8: Commit**

```bash
git add server/src/cookies.rs server/src/lib.rs web/src/App.svelte web/src/lib/tokenStore.ts
git commit -m "feat: switch browser auth to HttpOnly cookies, add /auth/session and /auth/logout endpoints"
```

---

### Task 17: Add `--require-auth` flag and remove loopback bypass

**Files:**
- Modify: `server/src/config.rs` (add flag)
- Modify: `server/src/lib.rs` (WebSocket handler, ~line 1080-1102)

**Step 1: Add CLI flag**

```rust
/// Require authentication for all connections including local/loopback
#[arg(long, default_value_t = false)]
pub require_auth: bool,
```

**Step 2: Update WebSocket auth bypass logic**

In `server/src/lib.rs`, change the skip_auth logic:

```rust
// Before:
let skip_auth = is_local || state.no_auth;

// After:
let skip_auth = state.no_auth || (is_local && !state.require_auth);
```

Add `require_auth: bool` to `AppState`.

**Step 3: Write test**

```rust
#[tokio::test]
async fn test_require_auth_blocks_local() {
    // With require_auth=true, even loopback connections should require auth
}
```

**Step 4: Run tests and commit**

```bash
git add server/src/config.rs server/src/lib.rs
git commit -m "feat(server): add --require-auth flag to enforce auth on local connections"
```

---

### Task 18: Remove `terminar.authToken` from VS Code settings

**Files:**
- Modify: `extension/package.json` (remove from contributes.configuration)
- Modify: `extension/src/settings.ts` (remove `getConfiguredAuthToken()`)
- Modify: `extension/src/extension.ts` (remove any references)

**Step 1: Remove setting from package.json**

Remove the `terminar.authToken` property from the configuration section.

**Step 2: Remove helper from settings.ts**

Remove `getConfiguredAuthToken()` function.

**Step 3: Update any code that reads the setting**

Search for `authToken` references and remove them. The extension should only read from `~/.terminar/token`.

**Step 4: Run extension tests**

Run: `cd packages/shell-protocol && pnpm build && cd ../../extension && pnpm compile && pnpm test`
Expected: All pass.

**Step 5: Commit**

```bash
git add extension/package.json extension/src/settings.ts extension/src/extension.ts
git commit -m "fix(extension): remove authToken from VS Code settings to avoid plaintext token exposure"
```

---

## Phase 4: Multi-User Gateway

### Task 19: Add `--user-mode` flag to terminar-server

**Files:**
- Modify: `server/src/config.rs` (add flag)
- Modify: `server/src/lib.rs` (startup, refuse root, skip auth in user-mode)

**Step 1: Add CLI flag**

```rust
/// Run in user-mode (spawned by gateway, skip own auth, refuse root)
#[arg(long, default_value_t = false)]
pub user_mode: bool,
```

**Step 2: Add root check**

At the top of the server startup in `lib.rs`:

```rust
if cli.user_mode {
    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        if uid == 0 {
            return Err("Refusing to run in --user-mode as root. This is a safety check.".into());
        }
    }
}
```

**Step 3: Skip auth in user-mode**

When `user_mode` is true, set `no_auth = true` internally (the gateway handles auth). Also skip writing the token file (gateway owns that).

**Step 4: Write test**

```rust
#[test]
fn test_user_mode_refuses_root() {
    // This test can only verify the logic, not actually run as root
    // Test the root-check function in isolation
}
```

**Step 5: Run tests and commit**

```bash
git add server/src/config.rs server/src/lib.rs
git commit -m "feat(server): add --user-mode flag with root refusal and auth bypass"
```

---

### Task 20: Create gateway binary scaffold

**Files:**
- Create: `server/src/bin/gateway.rs` (gateway entry point)
- Create: `server/src/gateway/mod.rs` (gateway module)
- Create: `server/src/gateway/config.rs` (gateway CLI config)
- Create: `server/src/gateway/proxy.rs` (WebSocket proxy)
- Create: `server/src/gateway/user_server.rs` (per-user server spawning)
- Modify: `server/Cargo.toml` (add gateway binary target)

**Step 1: Add binary target to Cargo.toml**

```toml
[[bin]]
name = "terminar-gateway"
path = "src/bin/gateway.rs"
```

**Step 2: Create gateway config**

In `server/src/gateway/config.rs`:

```rust
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "terminar-gateway")]
pub struct GatewayConfig {
    /// Listen port
    #[arg(short, long, default_value_t = 3000)]
    pub port: u16,

    /// TLS certificate PEM file
    #[arg(long)]
    pub tls_cert: Option<String>,

    /// TLS private key PEM file
    #[arg(long)]
    pub tls_key: Option<String>,

    /// Auto-generate TLS certificate
    #[arg(long, default_value_t = true)]
    pub auto_tls: bool,

    /// TLS port
    #[arg(long, default_value_t = 8444)]
    pub tls_port: u16,

    /// Path to terminar-server binary
    #[arg(long, default_value = "terminar-server")]
    pub server_bin: String,

    /// Per-user server socket directory
    #[arg(long, default_value = "/run/terminar")]
    pub socket_dir: String,

    /// Idle timeout for per-user servers (seconds)
    #[arg(long, default_value_t = 1800)]
    pub idle_timeout: u64,

    /// Max auth attempts
    #[arg(long, default_value_t = 5)]
    pub max_auth_attempts: usize,

    /// Audit log level
    #[arg(long, default_value = "standard")]
    pub audit_level: String,
}
```

**Step 3: Create gateway entry point**

In `server/src/bin/gateway.rs`:

```rust
use clap::Parser;
use terminar_server::gateway::{config::GatewayConfig, run_gateway};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = GatewayConfig::parse();
    run_gateway(config).await
}
```

**Step 4: Verify it compiles**

Run: `cd server && cargo build`
Expected: Compiles (gateway is a stub).

**Step 5: Commit**

```bash
git add server/src/bin/gateway.rs server/src/gateway/ server/Cargo.toml
git commit -m "feat(server): scaffold terminar-gateway binary with CLI config"
```

---

### Task 21: Implement per-user server manager

**Files:**
- Modify: `server/src/gateway/user_server.rs`

**Step 1: Write failing test**

```rust
#[tokio::test]
async fn test_user_server_spawn_command() {
    let manager = UserServerManager::new("/usr/local/bin/terminar-server", "/run/terminar", 1800);
    let cmd = manager.build_spawn_command("alice");
    assert_eq!(cmd.get_program(), "sudo");
    let args: Vec<_> = cmd.get_args().map(|a| a.to_str().unwrap()).collect();
    assert!(args.contains(&"-u"));
    assert!(args.contains(&"alice"));
    assert!(args.contains(&"--user-mode"));
    assert!(args.contains(&"--socket"));
    assert!(args[args.len()-1].contains("alice"));
}
```

**Step 2: Implement UserServerManager**

```rust
use std::collections::HashMap;
use tokio::process::Command;
use tokio::sync::Mutex;

pub struct UserServerInfo {
    pub socket_path: String,
    pub pid: u32,
    pub last_active: Instant,
}

pub struct UserServerManager {
    server_bin: String,
    socket_dir: String,
    idle_timeout: u64,
    servers: Mutex<HashMap<String, UserServerInfo>>,
}

impl UserServerManager {
    pub fn new(server_bin: &str, socket_dir: &str, idle_timeout: u64) -> Self { ... }

    pub fn build_spawn_command(&self, username: &str) -> Command {
        let socket_path = format!("{}/{}.sock", self.socket_dir, username);
        let mut cmd = Command::new("sudo");
        cmd.arg("-u").arg(username)
           .arg(&self.server_bin)
           .arg("--user-mode")
           .arg("--socket").arg(&socket_path);
        cmd
    }

    pub async fn ensure_server(&self, username: &str) -> Result<String, String> {
        // Check if server is already running (socket exists, process alive)
        // If not, spawn it via sudo
        // Wait for socket to appear (with timeout)
        // Return socket path
    }

    pub async fn shutdown_idle_servers(&self) { ... }
}
```

**Step 3: Run tests and commit**

```bash
git add server/src/gateway/user_server.rs
git commit -m "feat(gateway): implement UserServerManager for spawning per-user servers"
```

---

### Task 22: Implement WebSocket proxy

**Files:**
- Modify: `server/src/gateway/proxy.rs`

**Step 1: Write test**

```rust
#[tokio::test]
async fn test_proxy_forwards_messages_bidirectionally() {
    // Create two in-memory WebSocket pairs
    // Connect them through the proxy
    // Send message from client, verify it arrives at server
    // Send message from server, verify it arrives at client
}
```

**Step 2: Implement WebSocket proxy**

The proxy is simple — it takes two WebSocket streams and pipes messages bidirectionally:

```rust
pub async fn proxy_websocket(
    client: WebSocket,
    server_socket_path: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Connect to per-user server's Unix socket
    let server_stream = tokio::net::UnixStream::connect(server_socket_path).await?;

    // Upgrade to WebSocket (or use raw framing — depends on per-user server protocol)
    // Bidirectional pipe: client <-> server

    let (mut client_send, mut client_recv) = client.split();
    // ... forward messages in both directions using tokio::select!
}
```

**Step 3: Run tests and commit**

```bash
git add server/src/gateway/proxy.rs
git commit -m "feat(gateway): implement bidirectional WebSocket proxy to per-user servers"
```

---

### Task 23: Wire gateway auth + proxy + user server manager

**Files:**
- Modify: `server/src/gateway/mod.rs` (main `run_gateway()` function)

**Step 1: Implement `run_gateway()`**

```rust
pub async fn run_gateway(config: GatewayConfig) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Initialize audit logger
    // 2. Load/create TLS cert (reuse existing tls.rs)
    // 3. Create UserServerManager
    // 4. Create PAM password verifier (reuse existing auth.rs)
    // 5. Load/create JWT signing key (reuse existing jwt.rs)
    // 6. Build axum router:
    //    GET /ws → authenticate, then proxy to per-user server
    //    POST /pair/exchange → existing pairing flow
    //    GET /health → health check
    // 7. Start TLS listener
    // 8. Wait for shutdown signal

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/pair/exchange", post(exchange_handler))
        .route("/health", get(health_handler))
        .layer(security_headers_layer(tls_enabled));
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<GatewayState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| async move {
        // 1. Authenticate (reuse existing auth message handling)
        // 2. Extract username from JWT claims
        // 3. Ensure per-user server is running
        // 4. Proxy WebSocket to per-user server
    })
}
```

**Step 2: Run full test suite**

Run: `cd server && cargo test`
Expected: All pass.

**Step 3: Build both binaries**

Run: `cd server && cargo build`
Expected: Both `terminar-server` and `terminar-gateway` compile.

**Step 4: Commit**

```bash
git add server/src/gateway/
git commit -m "feat(gateway): wire auth, proxy, and user server manager into run_gateway()"
```

---

### Task 24: Add systemd and launchd service configs

**Files:**
- Create: `deploy/terminar-gateway.service` (systemd unit)
- Create: `deploy/com.terminar.gateway.plist` (macOS launchd)
- Create: `deploy/terminar-sudoers` (sudoers fragment)

**Step 1: Create systemd unit**

```ini
[Unit]
Description=terminar Gateway
After=network.target

[Service]
Type=simple
User=terminar
Group=terminar
ExecStart=/usr/local/bin/terminar-gateway --auto-tls
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

**Step 2: Create launchd plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.terminar.gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/terminar-gateway</string>
        <string>--auto-tls</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>UserName</key>
    <string>terminar</string>
</dict>
</plist>
```

**Step 3: Create sudoers fragment**

```
# /etc/sudoers.d/terminar
# Allow the terminar service user to spawn per-user servers
terminar ALL=(ALL) NOPASSWD: /usr/local/bin/terminar-server --user-mode --socket /run/terminar/*
```

**Step 4: Commit**

```bash
git add deploy/terminar-gateway.service deploy/com.terminar.gateway.plist deploy/terminar-sudoers
git commit -m "feat(deploy): add systemd, launchd, and sudoers configs for gateway"
```

---

### Task 25: Integration test — gateway + per-user server

**Files:**
- Create: `server/tests/gateway_integration.rs`

**Step 1: Write integration test**

```rust
#[tokio::test]
#[ignore] // Requires sudo, run manually
async fn test_gateway_spawns_user_server_and_proxies() {
    // 1. Start gateway on a random port
    // 2. Connect via WebSocket
    // 3. Authenticate with password
    // 4. Verify per-user server is spawned
    // 5. Create a session through the proxy
    // 6. Verify session appears in list
    // 7. Send input, verify output comes back
    // 8. Disconnect
    // 9. Verify per-user server is still running (for reconnection)
}
```

**Step 2: Commit**

```bash
git add server/tests/gateway_integration.rs
git commit -m "test(gateway): add integration test for gateway + per-user server flow"
```

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| **Phase 1: Foundation** | Tasks 1-8 | Auto-TLS, TOFU fingerprint, security headers, bundled xterm.css, WS rate limiting, trusted proxy, WSS enforcement, HTTPS redirect |
| **Phase 2: Audit** | Tasks 9-12 | AuditLogger module, event types, level filtering, async file writes, logrotate config |
| **Phase 3: Tokens** | Tasks 13-18 | 15-min access tokens, refresh rotation, persistent revocation, HttpOnly cookies, --require-auth, remove authToken setting |
| **Phase 4: Gateway** | Tasks 19-25 | --user-mode flag, gateway binary, user server manager, WS proxy, service configs, integration test |
