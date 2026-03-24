# V1 Local-Only Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip all network/remote/multi-user features from terminar, making it a local-only app distributed as Electron + Rust server binary.

**Architecture:** terminar-server communicates only via Unix socket (+ localhost HTTP for dev). The tray Electron app manages the server process directly. No gateway, no TLS, no remote auth, no system service installation. Web frontend exists for development only and is not shipped.

**Tech Stack:** Rust (server), Electron + Svelte 5 (tray), TypeScript (protocol)

---

## Task 1: Remove Gateway Binary and Server Gateway Code

**Files:**
- Delete: `server/src/bin/gateway.rs`
- Delete: `server/src/gateway/config.rs`
- Delete: `server/src/gateway/mod.rs`
- Delete: `server/src/gateway/proxy.rs`
- Delete: `server/src/gateway/user_server.rs`
- Modify: `server/Cargo.toml` — remove `[[bin]]` entry for `terminar-gateway`
- Modify: `server/src/lib.rs` — remove `pub mod gateway;`

**Step 1: Delete gateway files**
```bash
rm -rf server/src/bin/gateway.rs server/src/gateway/
```

**Step 2: Remove gateway binary from Cargo.toml**
In `server/Cargo.toml`, remove the `[[bin]]` block for `terminar-gateway`:
```toml
[[bin]]
name = "terminar-gateway"
path = "src/bin/gateway.rs"
```

**Step 3: Remove gateway module declaration from lib.rs**
In `server/src/lib.rs`, remove:
```rust
pub mod gateway;
```

**Step 4: Verify server builds**
```bash
cd server && cargo build 2>&1
```
Expected: Builds successfully (gateway was a standalone binary, no reverse deps in server code).

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(server): remove gateway binary and multi-user proxy code"
```

---

## Task 2: Remove TLS, JWT, Cookies, Revocation from Server

**Files:**
- Delete: `server/src/tls.rs`
- Delete: `server/src/jwt.rs`
- Delete: `server/src/cookies.rs`
- Delete: `server/src/revocation.rs`
- Modify: `server/src/lib.rs` — remove module declarations and all usages
- Modify: `server/src/config.rs` — remove TLS/auth CLI args
- Modify: `server/src/constants.rs` — remove token expiry, CORS, rate limit constants

**Step 1: Delete the files**
```bash
rm server/src/tls.rs server/src/jwt.rs server/src/cookies.rs server/src/revocation.rs
```

**Step 2: Remove module declarations from lib.rs**
Remove these lines from `server/src/lib.rs`:
```rust
pub mod cookies;
pub mod jwt;
pub mod revocation;
pub mod tls;
```

**Step 3: Remove TLS/JWT/cookie imports and usages from lib.rs**
In `server/src/lib.rs`, the `run_server()` function has:
- JWT signing key loading (`load_or_create_signing_key`)
- TLS config resolution (`resolve_tls_config`, `spawn_tls_server`)
- Revocation store initialization
- Cookie-based auth endpoints (`/auth/session`, `/auth/logout`, `/auth/refresh`, `/auth/revoke`)
- CORS middleware setup
- Password verifier creation (`create_platform_verifier`)

Remove all of these. The server should:
- Only listen on HTTP (localhost) and Unix socket
- Only use simple token auth (UUID from `~/.terminar/token`)
- Keep the `/health`, `/metrics`, `/ws`, `/settings`, `/workspace`, `/pair/exchange` endpoints
- Remove `/auth/session`, `/auth/logout`, `/auth/refresh`, `/auth/revoke` endpoints

Also remove from `AppState`:
- `signing_key` field
- `password_verifier` field
- `revocation_store` field
- `pairing_codes` field (pairing is for web auth flow)
- `rate_limiters` field

**Step 4: Simplify config.rs**
Remove CLI args:
- `--tls-cert`, `--tls-key`, `--tls-port`, `--auto-tls`
- `--max-auth-attempts`
- `--trusted-proxy`
- `--user-mode` (gateway spawns per-user servers)
- `--require-auth`
- `--cors-origin` (localhost only, hardcoded)

Keep:
- `--port` (for dev HTTP server)
- `--socket` (Unix socket path)
- `--log-level`, `--log-json`, `--log-file`
- `--no-auth` (dev mode)
- `--mock-pty` (testing)
- `--audit-level` (optional, keep for local auditing)
- `pair` subcommand (can remove if pairing flow is removed)

**Step 5: Simplify constants.rs**
Remove:
- `RATE_LIMIT_MAX_ATTEMPTS`, `RATE_LIMIT_WINDOW_SECS`
- `MAX_WS_AUTH_ATTEMPTS`
- `ACCESS_TOKEN_EXPIRY_SECS`, `REFRESH_TOKEN_EXPIRY_SECS`
- `DEFAULT_CORS_ORIGINS`

Keep:
- `PROTOCOL_VERSION`
- `SHELL_WHITELIST`, `ENV_BLOCKLIST`
- `PTY_READ_BUFFER_SIZE`, `DEFAULT_HISTORY_CAPACITY`, `COMPRESSION_THRESHOLD`
- `PERIODIC_SAVE_INTERVAL_SECS`
- `PING_INTERVAL`, `PONG_TIMEOUT`
- `SHUTDOWN_TIMEOUT_SECS`

**Step 6: Remove Cargo.toml dependencies no longer needed**
Remove:
- `jsonwebtoken` (JWT)
- `ring` (crypto for JWT signing)
- `ssh-key`, `signature` (SSH auth)
- `rcgen` (self-signed cert generation)
- `rustls`, `rustls-pemfile`, `rustls-pki-types` (TLS)
- `axum-server` (TLS HTTP server)
- `form_urlencoded` (cookie parsing)

Keep:
- `axum`, `tower`, `tower-http` (HTTP server + middleware for dev)
- `tokio`, `futures` (async runtime)
- `serde`, `serde_json` (serialization)
- `clap` (CLI)
- `tracing*` (logging)
- `uuid` (token generation)
- `zstd` (history compression)
- `terminar-core` (PTY, session, persistence)

**Step 7: Build and fix compilation errors**
```bash
cd server && cargo build 2>&1
```
Iteratively fix any remaining references to removed modules/types. This will likely involve:
- Removing auth-related match arms in WebSocket message handler
- Removing password auth flow from `handle_connection()`
- Simplifying the CORS setup (hardcode localhost origins or remove entirely for Unix socket)

**Step 8: Run server tests**
```bash
cd server && cargo test 2>&1
```
Some tests will need updating (remove gateway/auth tests). Keep session, I/O, workspace tests.

**Step 9: Commit**
```bash
git add -A && git commit -m "feat(server): remove TLS, JWT, cookies, revocation — local auth only"
```

---

## Task 3: Remove Remote Auth from Server (Password, SSH, Pairing)

**Files:**
- Delete: `server/src/auth.rs`
- Delete: `server/src/handlers/auth.rs`
- Modify: `server/src/handlers/mod.rs` — remove `pub mod auth;`
- Modify: `server/src/lib.rs` — remove auth handler dispatch, remove pairing endpoint
- Modify: `server/src/messages.rs` — remove auth message variants

**Step 1: Delete auth files**
```bash
rm server/src/auth.rs server/src/handlers/auth.rs
```

**Step 2: Remove module declarations**
In `server/src/handlers/mod.rs`, remove `pub mod auth;`
In `server/src/lib.rs`, remove `pub mod auth;`

**Step 3: Remove auth message variants from messages.rs**
In `server/src/messages.rs`, remove from `ClientMessage`:
- `AuthPassword`
- `AuthPubkeyInit`
- `AuthPubkeyVerify`
- `AuthToken`
- `RefreshToken`
- `PairRequest`

Remove from `ServerMessage`:
- `PairResponse`
- `AuthOk`
- `AuthChallenge`

Keep the basic `Auth` variant in `ClientMessage` (simple token auth: `{ type: "auth", token: "..." }`).

**Step 4: Remove auth dispatch from lib.rs WebSocket handler**
In the WebSocket message handler match, remove arms for `AuthPassword`, `AuthPubkeyInit`, `AuthPubkeyVerify`, `AuthToken`, `RefreshToken`, `PairRequest`.

Remove the `/pair/exchange` HTTP endpoint.
Remove `handle_pair_command()` and the `pair` CLI subcommand.

**Step 5: Remove pairing subcommand from config.rs**
Remove the `Subcommand::Pair` variant and related config.

**Step 6: Build and test**
```bash
cd server && cargo build && cargo test 2>&1
```

**Step 7: Commit**
```bash
git add -A && git commit -m "feat(server): remove password/SSH/pairing auth — keep simple token auth only"
```

---

## Task 4: Remove Security Headers, Audit (Optional), Connection Health (Keep)

**Files:**
- Delete: `server/src/security_headers.rs` (not needed for local, adds complexity)
- Modify: `server/src/lib.rs` — remove security headers middleware
- Keep: `server/src/audit.rs` (optional, controlled by `--audit-level off` default)
- Keep: `server/src/connection.rs` (useful for WebSocket health even locally)

**Step 1: Delete security_headers.rs**
```bash
rm server/src/security_headers.rs
```

**Step 2: Remove from lib.rs**
Remove `pub mod security_headers;` and the middleware layer in the router setup.

**Step 3: Make audit default to off**
In `server/src/config.rs`, change audit-level default from `"standard"` to `"off"`.

**Step 4: Build and test**
```bash
cd server && cargo build && cargo test 2>&1
```

**Step 5: Commit**
```bash
git add -A && git commit -m "feat(server): remove security headers middleware, default audit to off"
```

---

## Task 5: Clean Up Server Tests

**Files:**
- Delete: `server/tests/gateway_integration.rs`
- Delete: `server/tests/test_security.rs`
- Delete: `server/tests/test_websocket_integration.rs` (if it tests auth flows)
- Modify: `server/tests/test_messages.rs` — remove auth message tests
- Modify: `server/tests/test_failure_scenarios.rs` — remove auth failure tests
- Keep: `server/tests/test_unix_socket.rs`, `test_concurrency.rs`, `test_stress.rs`, `test_pty_failures.rs`

**Step 1: Delete gateway and security tests**
```bash
rm server/tests/gateway_integration.rs server/tests/test_security.rs
```

**Step 2: Update remaining tests**
Review and fix any tests that reference removed types (auth messages, JWT, gateway).

**Step 3: Run all server tests**
```bash
cd server && cargo test 2>&1
```
Expected: All remaining tests pass.

**Step 4: Run clippy**
```bash
cd server && cargo clippy 2>&1
```
Fix any warnings about dead code from removed features.

**Step 5: Commit**
```bash
git add -A && git commit -m "test(server): clean up tests for local-only mode"
```

---

## Task 6: Remove Deploy Files

**Files:**
- Delete: `deploy/com.terminar.gateway.plist`
- Delete: `deploy/terminar-gateway.service`
- Delete: `deploy/terminar-sudoers`
- Delete: `deploy/postinst.sh`
- Delete: `deploy/logrotate.d/terminar-audit`
- Delete: `deploy/logrotate.d/terminar-server`
- Consider: Delete entire `deploy/` directory if nothing remains

**Step 1: Delete deploy files**
```bash
rm -rf deploy/
```

**Step 2: Commit**
```bash
git add -A && git commit -m "chore: remove deploy files (gateway service configs, sudoers, logrotate)"
```

---

## Task 7: Simplify Tray App — Remove ServiceManager, Elevation, Install Wizard

**Files:**
- Delete: `tray/src/main/ServiceManager.ts`
- Delete: `tray/src/main/elevation.ts`
- Delete: `tray/src/renderer/Install.svelte`
- Delete: `tray/tests/unit/ServiceManager.test.ts`
- Delete: `tray/tests/unit/elevation.test.ts`
- Modify: `tray/src/main/ipc.ts` — remove service IPC handlers
- Modify: `tray/src/main/index.ts` — remove service check, install wizard
- Modify: `tray/src/preload/index.ts` — remove service IPC channels from preload

**Step 1: Delete files**
```bash
rm tray/src/main/ServiceManager.ts tray/src/main/elevation.ts tray/src/renderer/Install.svelte
rm tray/tests/unit/ServiceManager.test.ts tray/tests/unit/elevation.test.ts
```

**Step 2: Remove service IPC handlers from ipc.ts**
Remove handlers for:
- `tray:install-service`
- `tray:uninstall-service`
- `tray:restart-service`
- `tray:stop-service`
- `tray:start-service`
- `tray:get-service-status`

Remove the `ServiceManager` import and parameter.

**Step 3: Remove service logic from index.ts**
- Remove `ServiceManager` import and instantiation
- Remove service status check on startup
- Remove install wizard display logic
- Keep: `HealthPoller`, `WindowManager`, `TrayManager`, `ConfigStore`

**Step 4: Remove service channels from preload/index.ts**
Remove any `ipcRenderer.invoke('tray:*-service')` channels.

**Step 5: Build tray**
```bash
cd tray && pnpm dev
```
Check for TypeScript/import errors.

**Step 6: Commit**
```bash
git add -A && git commit -m "feat(tray): remove ServiceManager, elevation, install wizard"
```

---

## Task 8: Simplify Tray Menu and Config

**Files:**
- Modify: `tray/src/main/TrayManager.ts` — remove security/service menu items
- Modify: `tray/src/main/menuSpec.ts` — simplify to just status + open/settings/quit
- Modify: `tray/src/main/types.ts` — remove gateway/TLS/auth types
- Modify: `tray/src/main/ConfigStore.ts` — remove `toGatewayArgs()`, simplify config
- Modify: `tray/src/shared/types.ts` — simplify `TrayConfig`
- Modify: `tray/src/renderer/Settings.svelte` — remove Network/Security/Service sections
- Modify: `tray/tests/unit/computeMenuSpec.test.ts` — update for simplified menu

**Step 1: Simplify types.ts**
Remove:
- `ServiceStatus` type
- `ServiceActions` type
- Gateway/TLS/auth fields from `MenuSpec`

Keep:
- `GatewayStatus` → rename to `ServerStatus` (values: `'running' | 'starting' | 'stopped'`)
- `MenuSpec` with just: `status_text: string`, `is_running: boolean`

**Step 2: Simplify TrayConfig in shared/types.ts**
Remove gateway-specific fields:
- `gateway_port`, `tls_mode`, `tls_cert`, `tls_key`, `tls_port`, `require_auth`, `audit_level`, `idle_timeout`

Keep only essential settings (or make it an empty interface if no config needed).

**Step 3: Simplify menuSpec.ts**
Reduce to:
```typescript
export function computeMenuSpec(health: { status: ServerStatus }): MenuSpec {
  const is_running = health.status === 'running';
  const icon = is_running ? '●' : '○';
  const label = is_running ? 'Running' : 'Stopped';
  return { status_text: `Server: ${icon} ${label}`, is_running };
}
```

**Step 4: Simplify TrayManager.ts**
Remove menu actions: `toggle-tls`, `toggle-auth`, `audit-*`, `install-service`, `start-service`, `stop-service`, `restart-service`, `uninstall-service`.

Keep: `open-desktop-app`, `settings`, `quit`.

Remove `ServiceManager` from constructor.

**Step 5: Simplify ConfigStore.ts**
Remove `toGatewayArgs()` method and gateway-specific config loading.

**Step 6: Simplify Settings.svelte**
Remove "Network", "Security", and "Service" sections. Keep any remaining UI settings (theme, font, etc.) or simplify to minimal settings.

**Step 7: Update computeMenuSpec tests**
Rewrite tests for the simplified `computeMenuSpec()`.

**Step 8: Build and test tray**
```bash
cd tray && pnpm test -- --run && pnpm dev
```

**Step 9: Commit**
```bash
git add -A && git commit -m "feat(tray): simplify menu, config, and settings for local-only mode"
```

---

## Task 9: Update Package.json Scripts and Root Config

**Files:**
- Modify: `package.json` — remove gateway/mock scripts, simplify dev commands
- Modify: `pnpm-workspace.yaml` — verify workspace members

**Step 1: Simplify package.json scripts**
Remove:
- `dev:mock` (no mock PTY per project policy)
- Any gateway-related scripts

Update:
- `dev` should start server + tray (not web)
- `dev:web` can exist as separate command for web-only development
- `build` should build server + tray
- `test` should test server + tray

**Step 2: Commit**
```bash
git add -A && git commit -m "chore: simplify root scripts for local-only distribution"
```

---

## Task 10: Update CLAUDE.md and Architecture Docs

**Files:**
- Modify: `CLAUDE.md` — update for local-only architecture
- Modify: `docs/ARCHITECTURE.md` — remove gateway/multi-user sections

**Step 1: Update CLAUDE.md**
- Remove gateway binary references
- Remove multi-user mode section
- Remove TLS/auth CLI args from command reference
- Update directory structure (remove gateway files)
- Update architecture diagram to show local-only mode

**Step 2: Update docs/ARCHITECTURE.md**
- Remove multi-user gateway architecture
- Remove TLS/auth documentation
- Focus on single-user Unix socket architecture

**Step 3: Commit**
```bash
git add -A && git commit -m "docs: update architecture docs for v1 local-only mode"
```

---

## Task 11: Final Verification

**Step 1: Full server build + test**
```bash
cd server && cargo clean && cargo build && cargo test && cargo clippy
```

**Step 2: Full tray build + test**
```bash
cd tray && pnpm test -- --run && pnpm build
```

**Step 3: Full web build + test (dev mode only)**
```bash
cd web && pnpm test -- --run && pnpm build
```

**Step 4: Integration test — start server + tray**
```bash
pnpm dev:tray
```
Verify:
- Server starts on Unix socket + localhost HTTP
- Tray app shows in menu bar
- Terminal window opens and works
- No TLS/gateway/auth errors

**Step 5: Final commit if any fixes needed**
```bash
git add -A && git commit -m "fix: final cleanup for v1 local-only mode"
```
