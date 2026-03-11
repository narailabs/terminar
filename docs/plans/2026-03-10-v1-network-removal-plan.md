# V1 Network Removal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all network access features, making the server Unix-socket-only with a stdio mode for Windows/WSL. Delete the web frontend. Transform the tray app into the primary Electron terminal UI.

**Architecture:** Server communicates exclusively via Unix socket or stdio (length-prefixed JSON). Electron app spawns server as child process. VS Code extension connects via Unix socket. No TCP ports, no HTTP, no auth.

**Tech Stack:** Rust (tokio, portable-pty), TypeScript, Electron 40, Svelte 5, xterm.js

---

## Phase 1: Server Cleanup (compile + test after each task)

### Task 1: Delete standalone network/auth server files

Delete files that are entirely network/auth-related. No other file modifications yet.

**Files:**
- Delete: `server/src/bin/gateway.rs`
- Delete: `server/src/gateway/` (entire directory: `mod.rs`, `config.rs`, `proxy.rs`, `user_server.rs`)
- Delete: `server/src/tls.rs`
- Delete: `server/src/auth.rs`
- Delete: `server/src/jwt.rs`
- Delete: `server/src/cookies.rs`
- Delete: `server/src/revocation.rs`
- Delete: `server/src/security_headers.rs`
- Delete: `server/src/audit.rs`

**Step 1: Delete the files**

```bash
cd /Users/narayan/src/terminar/server
rm -f src/bin/gateway.rs
rm -rf src/gateway/
rm -f src/tls.rs src/auth.rs src/jwt.rs src/cookies.rs src/revocation.rs src/security_headers.rs src/audit.rs
```

**Step 2: Remove module declarations from `src/lib.rs`**

Remove all `mod` and `use` lines referencing deleted modules. Search for:
- `mod tls;`
- `mod auth;`
- `mod jwt;`
- `mod cookies;`
- `mod revocation;`
- `mod security_headers;`
- `mod audit;`
- `mod gateway;`
- Any `use` statements importing from these modules

**Step 3: Remove the gateway binary from `Cargo.toml`**

Remove the `[[bin]]` section for `terminar-gateway`.

**Step 4: Attempt `cargo check`**

Run: `cd /Users/narayan/src/terminar/server && cargo check 2>&1 | head -50`

Expected: Many compilation errors from `lib.rs`, `main.rs`, `config.rs`, `messages.rs`, `handlers/` referencing deleted modules. This is expected — subsequent tasks fix these.

**Step 5: Commit**

```bash
git add -A server/src/bin/gateway.rs server/src/gateway/ server/src/tls.rs server/src/auth.rs server/src/jwt.rs server/src/cookies.rs server/src/revocation.rs server/src/security_headers.rs server/src/audit.rs server/Cargo.toml server/src/lib.rs
git commit -m "chore: delete gateway, TLS, auth, JWT, cookies, revocation, audit files"
```

---

### Task 2: Strip Cargo.toml dependencies

Remove crates only used by deleted network/auth code.

**Files:**
- Modify: `server/Cargo.toml`

**Step 1: Remove these dependencies from `[dependencies]`**

Remove:
- `axum` (entire line with features)
- `axum-server` (with tls-rustls feature)
- `tower`
- `tower-http` (with cors, fs features)
- `rustls`
- `rustls-pemfile`
- `rcgen`
- `ring`
- `ssh-key` (with features)
- `signature`
- `jsonwebtoken`

Keep `base64` only if used outside auth (check `history.rs`, `persistence.rs`). Keep `hyper` only if used outside HTTP.

**Step 2: Remove any dev-dependencies only used by deleted test code**

Check dev-dependencies for HTTP test utilities (e.g., `reqwest`, `hyper` test helpers).

**Step 3: Attempt `cargo check`**

Run: `cd /Users/narayan/src/terminar/server && cargo check 2>&1 | head -50`

Expected: Still many errors (lib.rs references axum types), but dependency resolution should succeed.

**Step 4: Commit**

```bash
git add server/Cargo.toml
git commit -m "chore: remove network/auth crate dependencies from server"
```

---

### Task 3: Simplify config.rs

Strip CLI args to just `--socket`, `--stdio`, `--shell`, `--log-level`, `--no-auth`, `--mock-pty`.

**Files:**
- Modify: `server/src/config.rs`

**Step 1: Rewrite the `Cli` struct**

Keep only:
```rust
#[derive(Parser, Debug)]
#[command(name = "terminar-server")]
pub struct Cli {
    /// Unix socket path
    #[arg(long, default_value = "~/.terminar/server.sock")]
    pub socket: Option<String>,

    /// Communicate via stdin/stdout instead of Unix socket
    #[arg(long)]
    pub stdio: bool,

    /// Default shell
    #[arg(long, env = "SHELL")]
    pub shell: Option<String>,

    /// Log level
    #[arg(long, default_value = "info")]
    pub log_level: String,

    /// Disable authentication (dev mode)
    #[arg(long)]
    pub no_auth: bool,

    /// Use mock PTY (testing only)
    #[arg(long)]
    pub mock_pty: bool,
}
```

**Step 2: Remove the `pair` subcommand if it exists**

Check for `#[command(subcommand)]` or `Subcommand` enum. Remove pairing-related subcommands.

**Step 3: Update any `Cli` method implementations**

Remove `load()` logic that handles TLS config resolution, audit level defaults, etc. Simplify to just parse args.

**Step 4: Attempt `cargo check`**

Run: `cd /Users/narayan/src/terminar/server && cargo check 2>&1 | head -50`

Expected: Errors from `main.rs` and `lib.rs` referencing removed fields. These get fixed in later tasks.

**Step 5: Commit**

```bash
git add server/src/config.rs
git commit -m "chore: simplify server CLI to socket, stdio, shell, log-level"
```

---

### Task 4: Clean messages.rs — remove auth message types

**Files:**
- Modify: `server/src/messages.rs`

**Step 1: Remove auth variants from `ClientMessage` enum**

Remove these variants:
- `Auth { token, protocol_version }`
- `AuthPassword { username, password }`
- `AuthPubkeyInit { username, pubkey }`
- `AuthPubkeyVerify { signature, algorithm }`
- `AuthToken { token }`
- `RefreshToken { refresh_token }`
- `PairRequest`

**Step 2: Remove auth variants from `ServerMessage` enum**

Remove these variants:
- `AuthOk { token, expires, protocol_version, refresh_token }`
- `AuthChallenge { nonce }`
- `PairResponse { ... }`

Keep `Shutdown` if used for graceful shutdown signaling.

**Step 3: Remove auth-related tests**

Remove test functions:
- `test_client_message_auth()`
- `test_client_message_auth_password()`
- `test_client_message_auth_pubkey_init()`
- `test_client_message_auth_pubkey_verify()`
- `test_client_message_auth_token()`
- `test_client_message_refresh_token()`
- `test_server_message_auth_ok_with_refresh_token()`
- `test_server_message_auth_ok_without_refresh_token()`
- `test_server_message_auth_ok_with_jwt()`
- `test_server_message_auth_challenge()`

**Step 4: Attempt `cargo check`**

Run: `cd /Users/narayan/src/terminar/server && cargo check 2>&1 | head -50`

Expected: Errors from `lib.rs` matching on removed variants.

**Step 5: Commit**

```bash
git add server/src/messages.rs
git commit -m "chore: remove auth message types from wire protocol"
```

---

### Task 5: Gut lib.rs — remove HTTP/WebSocket/auth, keep Unix socket

This is the largest task. `lib.rs` is ~2500 lines. Remove all HTTP infrastructure while keeping the Unix socket listener and message dispatch.

**Files:**
- Modify: `server/src/lib.rs`

**Step 1: Remove HTTP-related imports**

Remove all `use` for: `axum`, `tower`, `tower_http`, `hyper`, `rustls`, `rcgen`, `jsonwebtoken`, `ring`, `ssh_key`.

Remove imports of deleted modules: `tls`, `auth`, `jwt`, `cookies`, `revocation`, `security_headers`, `audit`.

**Step 2: Strip AppState struct**

Remove these fields from `AppState`:
- `pairing_codes`
- `pairing_attempts`
- `password_verifier`
- `max_auth_attempts`
- `audit_logger`
- `trusted_proxy`
- `require_auth`
- `revocation_store`
- `tls_enabled`
- `revoked_tokens`
- `signing_key`
- `server_id`
- `api_key`

Keep:
- `sessions`
- `no_auth`
- `mock_provider`
- `shutdown_tx`
- `start_time`
- `sessions_total`
- `messages_processed_total`
- `session_name_counter`

**Step 3: Remove HTTP types and functions**

Delete these entire functions/blocks:
- `build_http_redirect_router` function
- `create_cors_layer` function
- `validate_websocket_origin` function
- `extract_client_ip` function
- `auth_middleware` function
- `exchange_handler` function
- `revoke_handler` function
- `refresh_handler` function
- `session_handler` function
- `logout_handler` function
- `health_handler` function
- `metrics_handler` function
- `get_settings_handler` / `put_settings_handler`
- `get_workspace_handler` / `put_workspace_handler`
- `ws_handler` function
- `handle_websocket` function
- All HTTP request/response structs (`ExchangeRequest`, `ExchangeResponse`, `HealthResponse`, `MetricsResponse`, `RevokeRequest`, `RevokeResponse`, `RefreshRequest`, `RefreshResponse`, `SessionAuthRequest`)

**Step 4: Remove HTTP server setup from `run_server`**

In the `run_server` function:
- Remove Router construction (the `Router::new().route(...)` block)
- Remove HTTP listener bind (`TcpListener::bind`)
- Remove TLS config resolution
- Remove TLS server spawn
- Remove token file writing
- Remove JWT key loading
- Remove pairing code map initialization
- Remove audit logger initialization

Keep:
- Socket path setup and `UnixListener::bind`
- Session restoration from persistence
- Background tasks (foreground polling, silence checking, persistence)
- Graceful shutdown logic
- The Unix socket accept loop

**Step 5: Clean `process_message` / `process_message_inner`**

Remove match arms for deleted `ClientMessage` variants:
- `PairRequest`
- Any auth-related variants

Keep all session/IO/workspace dispatch.

**Step 6: Remove handlers/auth.rs if it exists**

```bash
rm -f server/src/handlers/auth.rs
```

Remove `mod auth;` from `handlers/mod.rs`.

**Step 7: Build and test**

Run: `cd /Users/narayan/src/terminar/server && cargo build 2>&1`

Expected: Clean build. If errors remain, fix references to removed items.

Run: `cd /Users/narayan/src/terminar/server && cargo test 2>&1`

Expected: All remaining tests pass. Some tests may reference removed functionality — delete those test functions.

**Step 8: Run clippy**

Run: `cd /Users/narayan/src/terminar/server && cargo clippy 2>&1`

Fix any warnings (unused imports, dead code from partial removal).

**Step 9: Commit**

```bash
git add server/src/
git commit -m "feat: strip HTTP/WebSocket/auth from server, Unix socket only"
```

---

### Task 6: Add stdio transport mode

Add `--stdio` flag for Windows/WSL support. Server reads length-prefixed JSON from stdin, writes to stdout.

**Files:**
- Modify: `server/src/lib.rs`
- Create: `server/src/stdio.rs` (if separating cleanly)

**Step 1: Write a test for stdio message framing**

In `server/src/lib.rs` (or a new test file), add:

```rust
#[cfg(test)]
mod stdio_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt, duplex};

    #[tokio::test]
    async fn test_stdio_read_length_prefixed_message() {
        let msg = r#"{"type":"list_sessions"}"#;
        let len = msg.len() as u32;
        let mut buf = Vec::new();
        buf.extend_from_slice(&len.to_be_bytes());
        buf.extend_from_slice(msg.as_bytes());

        let (mut client, server) = duplex(1024);
        client.write_all(&buf).await.unwrap();
        drop(client);

        let (reader, _writer) = tokio::io::split(server);
        // Test that we can read one length-prefixed message
        let mut reader = reader;
        let mut len_buf = [0u8; 4];
        reader.read_exact(&mut len_buf).await.unwrap();
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut msg_buf = vec![0u8; len];
        reader.read_exact(&mut msg_buf).await.unwrap();
        assert_eq!(String::from_utf8(msg_buf).unwrap(), r#"{"type":"list_sessions"}"#);
    }
}
```

**Step 2: Run test to verify it passes**

Run: `cd /Users/narayan/src/terminar/server && cargo test stdio_tests -- --nocapture`

**Step 3: Implement stdio mode in `run_server`**

Add a branch at the top of `run_server`:

```rust
if cli.stdio {
    // Use stdin/stdout with length-prefixed framing
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    return run_stdio_server(state, stdin, stdout).await;
}
```

The `run_stdio_server` function should:
1. Wrap stdin/stdout in a buffered reader/writer
2. Use the same length-prefixed framing as Unix socket (`handle_connection`)
3. Process messages via `process_message`
4. Write responses back length-prefixed to stdout

This reuses the exact same framing the Unix socket `handle_connection` already uses.

**Step 4: Build and test**

Run: `cd /Users/narayan/src/terminar/server && cargo build && cargo test`

**Step 5: Commit**

```bash
git add server/src/
git commit -m "feat: add --stdio transport mode for Windows/WSL"
```

---

## Phase 2: Protocol Package Cleanup

### Task 7: Remove auth messages from shell-protocol

**Files:**
- Modify: `packages/shell-protocol/src/messages.ts`
- Modify: `packages/shell-protocol/src/client.ts`
- Modify: `packages/shell-protocol/src/websocket-manager.ts`

**Step 1: Remove auth message schemas from `messages.ts`**

Remove from client message types:
- `auth` schema
- `auth_password` schema
- `auth_pubkey_init` schema
- `auth_pubkey_verify` schema
- `auth_token` schema
- `refresh_token` schema

Remove from server message types:
- `AuthOk` schema
- `AuthChallenge` schema
- `PairResponse` schema

**Step 2: Simplify `client.ts`**

- Remove `token` parameter from `ShellClient` constructor
- Remove `_authenticated` field and `isAuthenticated` getter (or always true)
- Remove message queue logic — send messages immediately on connect
- Remove `AuthOk` and `AuthChallenge` handling from message dispatch
- Remove `ShellClientEvents` auth-related events

**Step 3: Simplify `websocket-manager.ts`**

- Remove `token` parameter from constructor
- Remove `isAuthenticated()` method or make it always return true
- Remove token sending on WebSocket open
- Remove `AuthOk` / `AuthChallenge` cases from `handleMessage`
- Remove `authenticated` / `authChallenge` events

**Step 4: Build and test**

Run: `cd /Users/narayan/src/terminar/packages/shell-protocol && pnpm build && pnpm test -- --run`

**Step 5: Run typecheck**

Run: `cd /Users/narayan/src/terminar/packages/shell-protocol && pnpm typecheck`

**Step 6: Commit**

```bash
git add packages/shell-protocol/
git commit -m "chore: remove auth messages from shell-protocol"
```

---

## Phase 3: VS Code Extension Cleanup

### Task 8: Remove auth from VS Code extension

**Files:**
- Modify: `extension/src/SessionManager.ts`
- Modify: `extension/src/extension.ts`
- Modify: `extension/src/WebSocketAdapter.ts` (if exists)

**Step 1: Simplify `SessionManager.ts`**

- Remove `readTokenFile()` function
- Remove `effectiveToken` field
- Remove `token` parameter from constructor
- Update `setupClient()`: `new ShellClient()` (no token)

**Step 2: Simplify `extension.ts`**

- Remove `readTokenFile` import
- In `setupManager()`: remove token file check, remove token parameter
- In `ensureServerRunning()`: remove token file polling loop. Just spawn server and connect when socket appears.

**Step 3: Simplify `WebSocketAdapter.ts`**

- Remove token from constructor
- Remove token passing to parent class

**Step 4: Build**

Run: `cd /Users/narayan/src/terminar && pnpm build` (builds shell-protocol first, then extension)

Run: `cd /Users/narayan/src/terminar/extension && pnpm compile`

**Step 5: Test**

Run: `cd /Users/narayan/src/terminar/extension && pnpm test`

**Step 6: Commit**

```bash
git add extension/
git commit -m "chore: remove auth from VS Code extension, direct socket connect"
```

---

## Phase 4: Tray/Electron App Transformation

### Task 9: Strip gateway management from tray app

Remove all gateway-specific code. The tray app will manage a local `terminar-server` child process instead.

**Files:**
- Modify: `tray/src/main/ServiceManager.ts`
- Modify: `tray/src/main/HealthPoller.ts`
- Modify: `tray/src/main/TrayManager.ts`
- Modify: `tray/src/main/ConfigStore.ts`
- Modify: `tray/src/main/WindowManager.ts`
- Modify: `tray/src/main/index.ts`
- Modify: `tray/src/main/ipc.ts`
- Delete: `tray/src/main/WebUIManager.ts`
- Delete: `tray/src/main/elevation.ts` (no sudo needed for local server)
- Modify: `tray/src/renderer/Settings.svelte`
- Modify: `tray/src/renderer/Install.svelte`
- Modify: `tray/src/main/menuSpec.ts`
- Modify: `tray/src/main/types.ts`

**Step 1: Rewrite `ServiceManager.ts` to spawn local server**

Replace gateway service management (launchd/systemd scripts) with direct child process spawning:

```typescript
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';

export class ServerManager {
  private serverProcess: ChildProcess | null = null;
  private socketPath: string;

  constructor() {
    this.socketPath = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.terminar',
      'server.sock'
    );
  }

  getServerBinaryPath(): string {
    // In packaged app: resources directory
    // In dev: cargo build output
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'terminar-server');
    }
    return path.join(__dirname, '../../server/target/debug/terminar-server');
  }

  async start(): Promise<void> {
    const bin = this.getServerBinaryPath();
    this.serverProcess = spawn(bin, ['--socket', this.socketPath], {
      stdio: 'pipe',
    });
    this.serverProcess.on('exit', (code) => {
      this.emit('exit', code);
    });
    // Wait for socket to appear
    await this.waitForSocket();
  }

  async stop(): Promise<void> {
    this.serverProcess?.kill('SIGTERM');
    this.serverProcess = null;
  }

  private async waitForSocket(timeoutMs = 5000): Promise<void> {
    // Poll for socket file existence
  }
}
```

**Step 2: Simplify `HealthPoller.ts`**

Replace HTTP `/health` polling with socket existence check + process liveness:

```typescript
// Instead of fetching http://localhost:port/health,
// check if this.serverProcess is alive and socket file exists
```

**Step 3: Simplify `ConfigStore.ts`**

Strip config to:
```typescript
interface TrayConfig {
  shell: string | null;
  log_level: string;
}
```

Remove: `gateway_port`, `tls_mode`, `tls_cert`, `tls_key`, `tls_port`, `require_auth`, `audit_level`, `idle_timeout`.

**Step 4: Simplify `TrayManager.ts` and `menuSpec.ts`**

Remove menu items:
- "Security" submenu (TLS, auth toggles)
- "Open Web UI" (no web app)
- Service install/uninstall actions (no system service)

Keep:
- Server status indicator (running/stopped)
- Start/Stop server
- Settings
- Quit

**Step 5: Delete `WebUIManager.ts` and `elevation.ts`**

```bash
rm tray/src/main/WebUIManager.ts tray/src/main/elevation.ts
```

**Step 6: Simplify `Settings.svelte`**

Remove: Network section (ports), Security section (TLS, auth), Service section (audit, idle timeout, uninstall).
Keep: Shell selection, log level. Add later: theme, keybindings.

**Step 7: Simplify or remove `Install.svelte`**

The install wizard was for gateway system service. Either:
- Remove entirely (no system service to install)
- Repurpose for first-run experience (shell selection, permissions check)

**Step 8: Update `index.ts`**

- Remove WebUIManager instantiation
- Replace ServiceManager with new ServerManager
- Start server on app ready
- Stop server on app quit

**Step 9: Update IPC handlers in `ipc.ts`**

Remove handlers for: service install/uninstall, elevation, gateway config. Simplify to: server start/stop, config get/set.

**Step 10: Fix tests**

Run: `cd /Users/narayan/src/terminar/tray && pnpm test -- --run`

Update or remove tests for deleted functionality. Fix tests for renamed/simplified classes.

**Step 11: Commit**

```bash
git add tray/
git commit -m "feat: transform tray app from gateway manager to local server manager"
```

---

### Task 10: Migrate terminal UI components from web/ to tray/

Move the xterm.js terminal components and supporting libraries into the Electron renderer.

**Files:**
- Copy from: `web/src/components/` → `tray/src/renderer/components/`
- Copy from: `web/src/lib/` → `tray/src/renderer/lib/`
- Modify: `tray/src/renderer/App.svelte`

**Step 1: Copy components**

```bash
cp -r web/src/components/ tray/src/renderer/components/
```

Key components to bring:
- `Terminal.svelte` — core xterm.js widget
- `Pane.svelte` — pane container
- `SplitContainer.svelte` — split layout
- `SplitHandle.svelte` — resize handles
- `TabBar.svelte` — tab row
- `WorkspaceView.svelte` — main layout
- `Sidebar.svelte` — session browser
- `SearchBar.svelte` — terminal search
- `ContextMenu.svelte` — right-click menu
- `SettingsPanel.svelte` — settings drawer
- `ConnectionStatus.svelte` — status indicator

Remove (don't copy):
- `LoginPage.svelte` — no auth UI needed

**Step 2: Copy lib modules**

```bash
cp -r web/src/lib/ tray/src/renderer/lib/
```

Key modules to bring:
- All stores (`*Store.svelte.ts`)
- `keyEventHandler.ts`, `keybindings.ts`
- `actionDispatcher.ts`
- `workspaceTypes.ts`, `themeTypes.ts`
- `shared-protocol.ts` barrel
- `LocalEchoManager.ts`

Remove (don't copy):
- `WebSocketSessionManager.ts` — replace with Unix socket session manager
- `WebSocketAdapter.ts` — replace with IPC-based adapter
- `connectionSingleton.ts` — replace with Electron IPC
- `HealthPoller.ts` — replaced by main process health
- `settingsApi.ts` — no HTTP settings API
- `sshKeyParser.ts`, `agentRegistry.ts` — no SSH auth

**Step 3: Create socket-based session manager for Electron**

The renderer process communicates with the main process via Electron IPC. The main process holds the Unix socket connection to the server.

Create `tray/src/renderer/lib/ElectronSessionManager.ts`:
```typescript
// Uses window.trayAPI (preload bridge) to send/receive messages
// Main process forwards to Unix socket
```

Update `tray/src/preload/index.ts` to expose terminal IPC:
```typescript
contextBridge.exposeInMainWorld('trayAPI', {
  // ... existing
  sendTerminalMessage: (msg: object) => ipcRenderer.send('terminal:message', msg),
  onTerminalMessage: (callback: (msg: object) => void) => {
    ipcRenderer.on('terminal:message', (_event, msg) => callback(msg));
  },
});
```

**Step 4: Wire up main process socket bridge**

In `tray/src/main/index.ts`, add IPC handler that forwards messages between renderer and Unix socket:

```typescript
ipcMain.on('terminal:message', (event, msg) => {
  serverManager.sendMessage(msg);
});

serverManager.onMessage((msg) => {
  mainWindow?.webContents.send('terminal:message', msg);
});
```

**Step 5: Update `App.svelte` to render terminal UI**

Replace the current Install/Settings router with WorkspaceView as the main content.

**Step 6: Verify build**

Run: `cd /Users/narayan/src/terminar/tray && pnpm dev`

Expected: Electron window opens showing terminal UI with split panes.

**Step 7: Commit**

```bash
git add tray/
git commit -m "feat: migrate terminal UI from web to Electron renderer"
```

---

### Task 11: Add WSL support for Windows

**Files:**
- Create: `tray/src/main/WslManager.ts`
- Modify: `tray/src/main/index.ts`
- Create: `tray/src/renderer/WslInstallGuide.svelte`

**Step 1: Write WSL detection**

Create `tray/src/main/WslManager.ts`:

```typescript
import { execSync, exec } from 'child_process';
import { app } from 'electron';

export class WslManager {
  static isWindows(): boolean {
    return process.platform === 'win32';
  }

  static isWslInstalled(): boolean {
    try {
      execSync('wsl.exe --status', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  static hasDistro(): boolean {
    try {
      const output = execSync('wsl.exe --list --quiet', { stdio: 'pipe', encoding: 'utf-8' });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  static getDefaultDistro(): string | null {
    try {
      const output = execSync('wsl.exe --list --quiet', { stdio: 'pipe', encoding: 'utf-8' });
      const lines = output.trim().split('\n').filter(l => l.trim());
      return lines[0]?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Spawn server inside WSL using stdio mode.
   * Returns a ChildProcess with stdin/stdout for communication.
   */
  static spawnServer(serverBinaryWslPath: string): ChildProcess {
    return spawn('wsl.exe', [serverBinaryWslPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Copy server binary into WSL filesystem.
   */
  static async installServerBinary(windowsPath: string, wslPath: string): Promise<void> {
    execSync(`wsl.exe cp "$(wslpath '${windowsPath}')" "${wslPath}"`, { stdio: 'pipe' });
    execSync(`wsl.exe chmod +x "${wslPath}"`, { stdio: 'pipe' });
  }
}
```

**Step 2: Create WSL install guide component**

Create `tray/src/renderer/WslInstallGuide.svelte`:
- Shown when `WslManager.isWslInstalled()` returns false
- Explains WSL, shows `wsl --install` command
- "Check again" button that re-checks via IPC
- Link to Microsoft docs

**Step 3: Integrate WSL into server startup**

In `tray/src/main/index.ts`, modify server start logic:

```typescript
if (WslManager.isWindows()) {
  if (!WslManager.isWslInstalled()) {
    // Show WSL install guide window
    windowManager.showWslGuide();
    return;
  }
  if (!WslManager.hasDistro()) {
    // Show distro install prompt
    return;
  }
  // Copy server binary to WSL if needed
  await WslManager.installServerBinary(bundledPath, wslPath);
  // Spawn via WSL with stdio
  serverProcess = WslManager.spawnServer(wslPath);
} else {
  // Unix: spawn directly with --socket
  serverProcess = spawn(serverBin, ['--socket', socketPath]);
}
```

**Step 4: Test on Windows (manual)**

Build the Electron app and test:
- Without WSL: should show install guide
- With WSL: should spawn server and show terminal

**Step 5: Commit**

```bash
git add tray/
git commit -m "feat: add WSL detection and stdio server bridge for Windows"
```

---

## Phase 5: Cleanup

### Task 12: Delete web/, deploy/, and update root configs

**Files:**
- Delete: `web/` (entire directory)
- Delete: `deploy/` (entire directory)
- Modify: `package.json` (root workspace)
- Modify: `CLAUDE.md`

**Step 1: Delete web/ and deploy/**

```bash
rm -rf web/ deploy/
```

**Step 2: Update root `package.json`**

Remove `web` from workspace list. Remove scripts referencing web:
- `dev` — change from "server + web" to "server + tray"
- `dev:all` — simplify
- `build` — remove web build
- `test:web` — remove

Update scripts:
```json
{
  "scripts": {
    "dev": "concurrently \"cd server && cargo run -- --no-auth\" \"cd tray && pnpm dev\"",
    "build": "cd server && cargo build --release && cd ../tray && pnpm build",
    "test": "pnpm test:server && pnpm test:tray",
    "test:server": "cd server && cargo test",
    "test:tray": "cd tray && pnpm test -- --run",
    "test:extension": "cd extension && pnpm test"
  }
}
```

**Step 3: Update `CLAUDE.md`**

- Remove web/ from directory structure
- Remove deploy/ from directory structure
- Remove web-related commands
- Update architecture diagram (no web frontend)
- Remove `pnpm dev:mock` references
- Update "Key Files" table

**Step 4: Update `docs/ARCHITECTURE.md`**

Remove web frontend section. Update diagrams. Note v2 deferred features.

**Step 5: Verify everything builds**

```bash
cd /Users/narayan/src/terminar
pnpm install  # Update lockfile after workspace change
pnpm build
pnpm test
```

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete web frontend and deploy configs, update workspace"
```

---

### Task 13: Update Electron packaging to bundle server binary

**Files:**
- Modify: `tray/electron-builder.yml`
- Modify: `tray/package.json`

**Step 1: Configure extra resources in `electron-builder.yml`**

```yaml
extraResources:
  - from: "../server/target/release/terminar-server"
    to: "terminar-server"
    filter:
      - "!*.d"

mac:
  target:
    - target: dmg
      arch:
        - universal
  extraResources:
    - from: "../server/target/release/terminar-server"
      to: "terminar-server"

linux:
  target:
    - AppImage
    - deb
  extraResources:
    - from: "../server/target/release/terminar-server"
      to: "terminar-server"

win:
  target:
    - nsis
  extraResources:
    - from: "../server/target/release/terminar-server"
      to: "terminar-server"
```

Note: For Windows, bundle the Linux binary (runs in WSL).

**Step 2: Add build script that compiles server first**

In `tray/package.json`:
```json
{
  "scripts": {
    "prebuild": "cd ../server && cargo build --release",
    "build": "electron-builder"
  }
}
```

**Step 3: Test packaging**

Run: `cd /Users/narayan/src/terminar/tray && pnpm build`

Verify the output contains `terminar-server` in resources.

**Step 4: Commit**

```bash
git add tray/
git commit -m "feat: bundle terminar-server binary with Electron app"
```

---

### Task 14: Final verification and cleanup

**Step 1: Full build from scratch**

```bash
cd /Users/narayan/src/terminar
pnpm install
cd packages/shell-protocol && pnpm build
cd ../../server && cargo build
cd ../tray && pnpm build
cd ../extension && pnpm compile
```

**Step 2: Full test suite**

```bash
cd /Users/narayan/src/terminar
cd server && cargo test && cargo clippy
cd ../packages/shell-protocol && pnpm test -- --run && pnpm typecheck
cd ../tray && pnpm test -- --run
cd ../extension && pnpm test
```

**Step 3: Manual smoke test**

```bash
cd /Users/narayan/src/terminar
pnpm dev  # Should start server + Electron
```

Verify:
- Electron window opens with terminal
- Can type commands, see output
- Split panes work
- Tabs work
- Server shuts down when Electron quits

**Step 4: Clean up any remaining dead code**

Run `cargo clippy` and fix warnings. Run `pnpm typecheck` in all packages.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup after network feature removal"
```
