# VS Code termiNar - Production Roadmap

**Created**: January 15, 2026
**Target**: Production-ready release
**Estimated Effort**: 4-6 weeks (1-2 engineers)

---

## Overview

This document provides a comprehensive, hierarchical task list to bring the VS Code termiNar from prototype to production quality. Tasks are organized by phase, priority, and component.

---

## Phase 1: Critical Bug Fixes (Week 1)

### 1.1 Rust Server - Threading Model Fix
> **Priority**: P0 - Blocking
> **Component**: `server/src/lib.rs`
> **Issue**: Blocking `std::thread::spawn` inside async tokio context causes potential deadlocks

- [ ] **1.1.1** Replace `std::thread::spawn` with proper async handling
  - [ ] Refactor PTY reader to use `tokio::task::spawn_blocking`
  - [ ] Store `JoinHandle` in Session struct for lifecycle management
  - [ ] Implement cancellation token pattern for graceful shutdown
  - [ ] Add timeout handling for blocking operations

- [ ] **1.1.2** Fix buffer size limitation
  - [ ] Increase read buffer from 1KB to 16KB
  - [ ] Implement dynamic buffer sizing based on output rate
  - [ ] Add configurable buffer size via CLI argument

- [ ] **1.1.3** Handle thread panics gracefully
  - [ ] Wrap reader loop in `std::panic::catch_unwind`
  - [ ] Log panic details before propagating
  - [ ] Send `SessionEvent::Error` on panic instead of silent failure

- [ ] **1.1.4** Synchronize concurrent PTY access
  - [ ] Add RwLock around master PTY operations
  - [ ] Document which operations need exclusive vs shared access
  - [ ] Ensure Input handler and Resize handler don't race with reader thread
  - [ ] Add tests for concurrent input + resize

### 1.2 Protocol - Newline Parsing Bug
> **Priority**: P0 - Blocking
> **Component**: `extension/src/NetSocketAdapter.ts`
> **Issue**: JSON messages with embedded newlines are corrupted

- [ ] **1.2.1** Implement length-prefixed framing protocol
  - [ ] Define frame format: `[4-byte length][JSON payload]`
  - [ ] Update `NetSocketAdapter.send()` to write length prefix
  - [ ] Update `NetSocketAdapter` data handler to parse frames
  - [ ] Handle partial frame reads with proper buffering

- [ ] **1.2.2** Update Rust server for framed protocol
  - [ ] Add frame parsing to Unix socket handler (`lib.rs:241-269`)
  - [ ] Add frame writing to server responses
  - [ ] Maintain backward compatibility flag for migration period

- [ ] **1.2.3** Add protocol version negotiation
  - [ ] Define `ProtocolVersion` enum (v1 = newline, v2 = framed)
  - [ ] Client sends version in initial handshake
  - [ ] Server responds with supported version
  - [ ] Document migration path for existing clients

### 1.3 Rust Server - Mutex Panic Prevention
> **Priority**: P0 - Blocking
> **Component**: `server/src/lib.rs`
> **Issue**: `.unwrap()` on mutex lock causes cascade failures

- [ ] **1.3.1** Replace `std::sync::Mutex` with `parking_lot::Mutex`
  - [ ] Add `parking_lot` to Cargo.toml
  - [ ] Replace all `std::sync::Mutex` imports
  - [ ] Remove `.unwrap()` calls (parking_lot doesn't poison)
  - [ ] Update all lock acquisition sites (~15 locations)

- [ ] **1.3.2** Add error context to remaining unwraps
  - [ ] Replace `.unwrap()` with `.expect("context")`
  - [ ] Add structured logging before panics
  - [ ] Document panic conditions in code comments

### 1.4 Session Cleanup - Resource Leaks
> **Priority**: P0 - Blocking
> **Component**: `server/src/session.rs`, `server/src/lib.rs`
> **Issue**: Sessions leak file descriptors and orphan threads

- [ ] **1.4.1** Implement `Drop` trait for Session
  - [ ] Create `impl Drop for Session`
  - [ ] Close PTY master explicitly
  - [ ] Signal reader thread to stop via atomic flag
  - [ ] Wait for reader thread with timeout (5s)
  - [ ] Log resource cleanup for debugging

- [ ] **1.4.2** Track background tasks with JoinHandles
  - [ ] Add `reader_handle: Option<JoinHandle<()>>` to Session
  - [ ] Store handle on session creation
  - [ ] Abort handle in `Drop` if still running
  - [ ] Add metrics for orphaned task detection

- [ ] **1.4.3** Implement session state machine
  - [ ] Define states: `Creating`, `Running`, `Closing`, `Closed`, `Error`
  - [ ] Add `state: SessionState` field to Session
  - [ ] Validate state transitions in message handlers
  - [ ] Reject invalid operations (e.g., Input on Closed session)

### 1.5 Mock PTY Fix
> **Priority**: P0 - Blocking (tests)
> **Component**: `server/src/pty.rs`
> **Issue**: `wait()` blocks forever, hanging tests

- [ ] **1.5.1** Fix MockChildKiller implementation
  - [ ] Return synthetic `ExitStatus` instead of blocking
  - [ ] Add configurable exit code for test scenarios
  - [ ] Implement `try_wait()` to return `Some(status)` after delay

- [ ] **1.5.2** Add MockPty test scenarios
  - [ ] Normal exit (code 0)
  - [ ] Error exit (code 1)
  - [ ] Signal termination (SIGTERM, SIGKILL)
  - [ ] Timeout scenario

- [ ] **1.5.3** Fix MockReader lock during blocking recv
  - [ ] Release mutex before calling `recv()` to prevent deadlock
  - [ ] Use channel with timeout instead of blocking recv
  - [ ] Ensure other threads can write while reader waits
  - [ ] Add test for concurrent read/write operations

---

## Phase 2: Security Hardening (Week 2)

### 2.1 Authentication Improvements
> **Priority**: P0 - Security
> **Component**: Multiple

- [ ] **2.1.1** Remove hardcoded dev token
  - [ ] Remove default `'dev-token'` from `SessionManager.ts:10`
  - [ ] Require explicit token parameter (throw if missing)
  - [ ] Update extension to read token from settings or keychain
  - [ ] Add VS Code setting: `terminar.authToken`

- [ ] **2.1.2** Implement rate limiting on pairing endpoint
  - [ ] Add `tower::limit::RateLimitLayer` to `/pair/exchange`
  - [ ] Configure: 10 requests per minute per IP
  - [ ] Return `429 Too Many Requests` on limit
  - [ ] Log rate limit violations with IP address

- [ ] **2.1.3** Add pairing code complexity
  - [ ] Increase code length from 6 to 8 digits
  - [ ] Add alphanumeric option (configurable)
  - [ ] Implement exponential backoff on failed attempts
  - [ ] Lock out IP after 5 failed attempts for 15 minutes

- [ ] **2.1.4** Implement token revocation
  - [ ] Add `/auth/revoke` endpoint
  - [ ] Store revoked tokens in memory set
  - [ ] Check revocation list in auth middleware
  - [ ] Add CLI command: `terminar-server revoke <token>`

- [ ] **2.1.5** Move token from query string to Authorization header
  - [ ] Update web frontend to use `Authorization: Bearer` header
  - [ ] Server already supports both (lib.rs:154-156)
  - [ ] Update terminar-protocol WebSocket adapter
  - [ ] Document security rationale (query strings leak to logs/history)

### 2.2 TLS Support
> **Priority**: P1 - Security
> **Component**: `server/src/main.rs`, `server/src/lib.rs`

- [ ] **2.2.1** Add TLS configuration
  - [ ] Add `rustls` and `axum-server` dependencies
  - [ ] Add CLI flags: `--cert`, `--key`, `--tls-port`
  - [ ] Support PEM and PKCS12 certificate formats
  - [ ] Add self-signed cert generation command

- [ ] **2.2.2** Update WebSocket to use WSS
  - [ ] Configure Axum for HTTPS
  - [ ] Redirect HTTP to HTTPS (optional flag)
  - [ ] Update web frontend to use `wss://` URLs
  - [ ] Document certificate setup in README

- [ ] **2.2.3** Add certificate validation options
  - [ ] Support custom CA certificates
  - [ ] Add `--insecure` flag for development
  - [ ] Warn loudly when insecure mode is used

### 2.3 Input Validation & Sanitization
> **Priority**: P1 - Security
> **Component**: `server/src/lib.rs`

- [ ] **2.3.1** Validate shell parameter
  - [ ] Create whitelist: `["/bin/bash", "/bin/sh", "/bin/zsh", "/usr/bin/fish"]`
  - [ ] Reject shells not in whitelist
  - [ ] Add configurable whitelist via config file
  - [ ] Log rejected shell attempts

- [ ] **2.3.2** Sanitize environment variables
  - [ ] Create blocklist: `["LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_*"]`
  - [ ] Filter blocked vars from `env` parameter
  - [ ] Log filtered variables (without values)
  - [ ] Add configurable allowlist mode

- [ ] **2.3.3** Validate working directory
  - [ ] Check path exists and is accessible
  - [ ] Optional: restrict to user's home directory subtree
  - [ ] Reject paths with `..` traversal
  - [ ] Return error message on invalid path

- [ ] **2.3.4** Validate terminal dimensions
  - [ ] Enforce range: cols 1-500, rows 1-500
  - [ ] Clamp out-of-range values with warning
  - [ ] Log suspicious dimension requests

### 2.4 CORS & Origin Validation
> **Priority**: P1 - Security
> **Component**: `server/src/lib.rs`

- [ ] **2.4.1** Replace permissive CORS
  - [ ] Remove `CorsLayer::permissive()`
  - [ ] Add configurable allowed origins list
  - [ ] Default to `["http://localhost:*"]` for development
  - [ ] Add `--cors-origin` CLI flag

- [ ] **2.4.2** Validate WebSocket upgrade origin
  - [ ] Check `Origin` header against whitelist
  - [ ] Reject upgrades from unknown origins
  - [ ] Log rejected origins for debugging

---

## Phase 3: Reliability & Resilience (Week 3)

### 3.1 Reconnection Logic
> **Priority**: P1 - Reliability
> **Component**: `extension/src/SessionManager.ts`, `web/src/lib/WebSocketSessionManager.ts`

- [ ] **3.1.1** Implement exponential backoff for extension
  - [ ] Add `reconnect()` method to SessionManager
  - [ ] Implement backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  - [ ] Add jitter (0-500ms random) to prevent thundering herd
  - [ ] Emit `'reconnecting'` and `'reconnected'` events
  - [ ] Cap max retry attempts (configurable, default 10)

- [ ] **3.1.2** Implement reconnection for web frontend
  - [ ] Add same backoff logic to WebSocketSessionManager
  - [ ] Show reconnection status in UI
  - [ ] Preserve session list across reconnections
  - [ ] Re-attach to active terminal on reconnect

- [ ] **3.1.3** Add connection health monitoring
  - [ ] Implement WebSocket ping/pong (30s interval)
  - [ ] Detect stale connections (no pong in 60s)
  - [ ] Auto-reconnect on detected staleness
  - [ ] Add connection latency metrics

### 3.2 Graceful Shutdown
> **Priority**: P1 - Reliability
> **Component**: `server/src/main.rs`, `server/src/lib.rs`

- [ ] **3.2.1** Implement signal handling
  - [ ] Add `tokio::signal` for SIGTERM, SIGINT
  - [ ] Create shutdown broadcast channel
  - [ ] Notify all tasks of pending shutdown
  - [ ] Set shutdown timeout (30s default)

- [ ] **3.2.2** Graceful client disconnection
  - [ ] Send `ServerMessage::Shutdown` to all clients
  - [ ] Wait for in-flight messages (5s timeout)
  - [ ] Close WebSocket connections cleanly
  - [ ] Close Unix socket connections cleanly

- [ ] **3.2.3** Clean up resources on shutdown
  - [ ] Kill all PTY processes (SIGTERM, then SIGKILL)
  - [ ] Join all reader threads
  - [ ] Remove Unix socket file
  - [ ] Log final statistics (sessions served, uptime)

### 3.3 History Buffer Management
> **Priority**: P1 - Reliability
> **Component**: `server/src/lib.rs`, `server/src/session.rs`

- [ ] **3.3.1** Implement circular buffer
  - [ ] Replace `Vec<u8>` with circular buffer type
  - [ ] Set default max size: 10MB per session
  - [ ] Add `--history-size` CLI flag
  - [ ] Implement efficient append and replay

- [ ] **3.3.2** Add history compression (optional)
  - [ ] Compress history with zstd when > 1MB
  - [ ] Decompress on replay
  - [ ] Add `--compress-history` flag

- [ ] **3.3.3** Add history persistence (optional)
  - [ ] Write history to disk on session close
  - [ ] Load history on session resume
  - [ ] Add `--persist-history` flag
  - [ ] Implement history file rotation

- [ ] **3.3.4** Fix broadcast subscriber leak
  - [ ] Add subscriber cleanup in Session Drop implementation
  - [ ] Track active subscribers count per session
  - [ ] Log subscriber growth for monitoring
  - [ ] Add metric: `session_broadcast_subscribers` gauge

### 3.4 Fix take_writer() Design
> **Priority**: P1 - Reliability
> **Component**: `server/src/lib.rs`, `server/src/session.rs`

- [ ] **3.4.1** Store writer persistently in Session
  - [ ] Add `writer: Arc<Mutex<Box<dyn Write + Send>>>` to Session
  - [ ] Initialize writer during session creation
  - [ ] Remove `take_writer()` calls
  - [ ] Use `writer.lock().write()` for input

- [ ] **3.4.2** Add write error handling
  - [ ] Return `Result` from input handler
  - [ ] Send `ServerMessage::Error` on write failure
  - [ ] Log write errors with session context
  - [ ] Consider marking session as errored

---

## Phase 4: Code Quality & Type Safety (Week 4)

### 4.1 TypeScript Type Safety
> **Priority**: P2 - Quality
> **Component**: `extension/src/*.ts`

- [ ] **4.1.1** Remove all `any` types from extension
  - [ ] `extension.ts:77` - type `sessions` parameter
  - [ ] `SessionTreeProvider.ts:8` - type `sessions` array
  - [ ] Add `SessionInfo` import from terminar-protocol
  - [ ] Enable `noImplicitAny` in tsconfig

- [ ] **4.1.2** Add strict TypeScript configuration
  - [ ] Enable `strict: true` in tsconfig.json
  - [ ] Enable `noUncheckedIndexedAccess`
  - [ ] Enable `exactOptionalPropertyTypes`
  - [ ] Fix all resulting type errors

- [ ] **4.1.3** Add JSDoc documentation
  - [ ] Document all public classes and methods
  - [ ] Add @param and @returns annotations
  - [ ] Add @throws for error conditions
  - [ ] Add @example for complex APIs

### 4.2 Shell Protocol Improvements
> **Priority**: P2 - Quality
> **Component**: `packages/terminar-protocol/src/*`

- [ ] **4.2.1** Fix schema/type mismatches
  - [ ] Add `kill_session` to ClientMessage schema
  - [ ] Change `mode` to enum: `z.enum(['mirror', 'steal'])`
  - [ ] Add auth failure response type
  - [ ] Add session rename confirmation type

- [ ] **4.2.2** Track authentication state
  - [ ] Set `authenticated = true` after successful auth
  - [ ] Emit `'authenticated'` event
  - [ ] Queue messages sent before auth
  - [ ] Flush queue after authentication

- [ ] **4.2.3** Improve error discrimination
  - [ ] Distinguish JSON parse errors from validation errors
  - [ ] Add error codes to Error messages
  - [ ] Create typed error classes

- [ ] **4.2.4** Implement missing exports
  - [ ] Export `frameMessage()` and `parseFrames()` functions
  - [ ] Export Zod schemas (ClientMessageSchema, ServerMessageSchema)
  - [ ] Export TypeScript types (ClientMessage, ServerMessage, SessionInfo)
  - [ ] Update `index.ts` to re-export from messages.ts and new framing.ts

### 4.3 Rust Code Organization
> **Priority**: P2 - Quality
> **Component**: `server/src/lib.rs`

- [ ] **4.3.1** Extract message handlers
  - [ ] Create `server/src/handlers/mod.rs`
  - [ ] Move `process_message` logic to handlers
  - [ ] Create handler per message type:
    - [ ] `handlers/session.rs` (create, kill, rename, list)
    - [ ] `handlers/io.rs` (input, resize, attach)
    - [ ] `handlers/auth.rs` (auth, pair)

- [ ] **4.3.2** Extract constants
  - [ ] Create `server/src/constants.rs`
  - [ ] Move magic numbers: buffer sizes, timeouts, limits
  - [ ] Add documentation for each constant
  - [ ] Make configurable where appropriate

- [ ] **4.3.3** Add structured error types
  - [ ] Create `server/src/error.rs`
  - [ ] Define `ServerError` enum
  - [ ] Implement `From` for common error types
  - [ ] Use `thiserror` for derive macros

### 4.4 Remove Dead Code
> **Priority**: P3 - Cleanup
> **Component**: Multiple

- [ ] **4.4.1** Remove unused Rust code
  - [ ] `ClientMessage::Auth` - implement or remove
  - [ ] Unused imports in lib.rs
  - [ ] Dead assignment in session creation

- [ ] **4.4.2** Remove unused TypeScript code
  - [ ] Incomplete `connectRemote` stub
  - [ ] Empty lifecycle hooks in Terminar
  - [ ] Unused imports

---

## Phase 5: Testing (Week 4-5)

### 5.1 Rust Server Tests
> **Priority**: P1 - Quality
> **Component**: `server/tests/*`

- [ ] **5.1.1** Add Unix socket integration tests
  - [ ] Test session lifecycle via Unix socket
  - [ ] Test concurrent connections
  - [ ] Test large message handling
  - [ ] Test reconnection after disconnect

- [ ] **5.1.2** Add PTY failure scenario tests
  - [ ] Shell crash (SIGSEGV)
  - [ ] Shell exit with error code
  - [ ] PTY creation failure (resource exhaustion)
  - [ ] Disk full during history write

- [ ] **5.1.3** Add stress tests
  - [ ] Rapid session create/delete (100 sessions)
  - [ ] Large output handling (10MB)
  - [ ] Many concurrent clients (50+)
  - [ ] Long-running session (1 hour)

- [ ] **5.1.4** Add security tests
  - [ ] Auth bypass attempts
  - [ ] Malformed message handling
  - [ ] Path traversal attempts
  - [ ] Environment injection attempts

### 5.2 TypeScript Tests
> **Priority**: P1 - Quality
> **Component**: `extension/src/test/*`, `web/src/*.test.ts`

- [ ] **5.2.1** Add negative test cases
  - [ ] Connection failure handling
  - [ ] Invalid message handling
  - [ ] Server crash recovery
  - [ ] Timeout handling

- [ ] **5.2.2** Add reconnection tests
  - [ ] Test exponential backoff timing
  - [ ] Test max retry limit
  - [ ] Test successful reconnection
  - [ ] Test state preservation

- [ ] **5.2.3** Improve E2E test reliability
  - [ ] Use test fixtures instead of live server
  - [ ] Add proper cleanup between tests
  - [ ] Add timeout assertions
  - [ ] Use deterministic port allocation

### 5.3 Test Infrastructure
> **Priority**: P2 - Quality
> **Component**: Multiple

- [ ] **5.3.1** Add code coverage tracking
  - [ ] Configure `cargo-tarpaulin` for Rust
  - [ ] Configure `c8` or `nyc` for TypeScript
  - [ ] Set coverage thresholds (target: 80%)
  - [ ] Add coverage badges to README

- [ ] **5.3.2** Add CI pipeline
  - [ ] GitHub Actions workflow
  - [ ] Run tests on PR
  - [ ] Run linting (clippy, eslint)
  - [ ] Build all artifacts
  - [ ] Upload test results

---

## Phase 6: Features & Polish (Week 5-6)

### 6.1 Web Frontend Completion
> **Priority**: P2 - Feature
> **Component**: `web/src/*`

- [ ] **6.1.1** Implement terminal resize
  - [ ] Complete TODO in `Terminal.svelte:51`
  - [ ] Send resize message on ResizeObserver callback
  - [ ] Debounce resize events (100ms)
  - [ ] Test resize behavior

- [ ] **6.1.2** Use terminar-protocol library
  - [ ] Replace inline message handling
  - [ ] Import ShellClient from @narai/terminar-protocol
  - [ ] Create WebSocketAdapter (similar to NetSocketAdapter)
  - [ ] Remove duplicated validation logic

- [ ] **6.1.3** Add connection state UI
  - [ ] Show connecting/connected/disconnected status
  - [ ] Show reconnection countdown
  - [ ] Add manual reconnect button
  - [ ] Persist token in localStorage

### 6.2 VS Code Extension Polish
> **Priority**: P2 - Feature
> **Component**: `extension/src/*`

- [ ] **6.2.1** Implement remote connection
  - [ ] Complete `connectRemote` command
  - [ ] Add input dialog for host:port
  - [ ] Add input dialog for pairing code
  - [ ] Implement HTTP token exchange
  - [ ] Switch to WebSocket connection

- [ ] **6.2.2** Improve TreeView
  - [ ] Add session status icons (running/idle/error)
  - [ ] Add context menu (rename, kill)
  - [ ] Show session uptime
  - [ ] Add drag-and-drop reordering

- [ ] **6.2.3** Add settings
  - [ ] `terminar.serverPath` - custom server binary
  - [ ] `terminar.socketPath` - custom socket path
  - [ ] `terminar.authToken` - stored token
  - [ ] `terminar.autoStart` - auto-start server

- [ ] **6.2.4** Add proper deactivate handler
  - [ ] Implement `deactivate()` function
  - [ ] Clean up socket connections
  - [ ] Dispose output channel
  - [ ] Remove all event listeners (SessionManager, SessionTreeProvider)
  - [ ] Clear activeTerminals map
  - [ ] Optionally stop server

- [ ] **6.2.5** Handle ServerController errors
  - [ ] Listen to `serverController.on('error')` in extension.ts
  - [ ] Show user notification on server spawn failure
  - [ ] Offer retry option or manual start instructions
  - [ ] Log error details to output channel

### 6.3 Server Features
> **Priority**: P2 - Feature
> **Component**: `server/src/*`

- [ ] **6.3.1** Add health check endpoint
  - [ ] `GET /health` returns 200 OK
  - [ ] Include version, uptime, session count
  - [ ] Add `GET /metrics` for Prometheus format

- [ ] **6.3.2** Add session persistence
  - [ ] Save session metadata to JSON file
  - [ ] Restore sessions on server restart
  - [ ] Reconnect to orphaned PTY processes
  - [ ] Add `--persist-sessions` flag

- [ ] **6.3.3** Add logging improvements
  - [ ] Add structured JSON logging option
  - [ ] Add request ID for tracing
  - [ ] Log session lifecycle events
  - [ ] Add `--log-level` flag
  - [ ] Add `--log-file` flag

---

## Phase 7: Documentation & Packaging (Week 6)

### 7.1 Documentation
> **Priority**: P2 - Documentation
> **Component**: `docs/*`, `README.md`

- [ ] **7.1.1** Update README.md
  - [ ] Add architecture diagram
  - [ ] Add quick start guide
  - [ ] Add configuration reference
  - [ ] Add troubleshooting section

- [ ] **7.1.2** Create API documentation
  - [ ] Document protocol messages
  - [ ] Document REST endpoints
  - [ ] Document WebSocket events
  - [ ] Add example request/response

- [ ] **7.1.3** Create operator guide
  - [ ] Installation instructions
  - [ ] TLS certificate setup
  - [ ] Firewall configuration
  - [ ] Monitoring setup

- [ ] **7.1.4** Add inline code documentation
  - [ ] Rust doc comments for public APIs
  - [ ] JSDoc for TypeScript
  - [ ] Architecture decision records (ADRs)

### 7.2 Packaging & Distribution
> **Priority**: P2 - Release
> **Component**: Build system

- [ ] **7.2.1** Create VS Code extension package
  - [ ] Update `package.json` with proper metadata
  - [ ] Add extension icon
  - [ ] Create `.vsix` package
  - [ ] Test installation from VSIX

- [ ] **7.2.2** Create server binaries
  - [ ] Cross-compile for Linux (x86_64, aarch64)
  - [ ] Cross-compile for macOS (x86_64, aarch64)
  - [ ] Cross-compile for Windows (x86_64)
  - [ ] Create GitHub release with binaries

- [ ] **7.2.3** Create container image
  - [ ] Write Dockerfile
  - [ ] Multi-stage build for small image
  - [ ] Publish to GitHub Container Registry
  - [ ] Add Helm chart (optional)

- [ ] **7.2.4** Add installation scripts
  - [ ] Shell script for Unix (curl | sh)
  - [ ] PowerShell script for Windows
  - [ ] Homebrew formula (optional)

---

## Phase 8: Production Readiness (Week 6+)

### 8.1 Performance Testing
> **Priority**: P2 - Production
> **Component**: All

- [ ] **8.1.1** Load testing
  - [ ] Test 100 concurrent sessions
  - [ ] Test 1000 messages/second
  - [ ] Measure memory usage over time
  - [ ] Identify performance bottlenecks

- [ ] **8.1.2** Memory leak testing
  - [ ] Run server for 24 hours
  - [ ] Monitor memory growth
  - [ ] Use Valgrind/heaptrack for analysis
  - [ ] Fix identified leaks

- [ ] **8.1.3** Benchmarking
  - [ ] Measure message latency
  - [ ] Measure session creation time
  - [ ] Compare Unix socket vs WebSocket
  - [ ] Document performance characteristics

### 8.2 Observability
> **Priority**: P2 - Production
> **Component**: `server/src/*`

- [ ] **8.2.1** Add metrics
  - [ ] `sessions_total` counter
  - [ ] `sessions_active` gauge
  - [ ] `messages_processed_total` counter
  - [ ] `message_latency_seconds` histogram
  - [ ] `history_bytes` gauge per session

- [ ] **8.2.2** Add tracing
  - [ ] Integrate with `tracing` crate
  - [ ] Add span for each request
  - [ ] Add span for session operations
  - [ ] Support OpenTelemetry export

- [ ] **8.2.3** Add alerting rules
  - [ ] High memory usage alert
  - [ ] High error rate alert
  - [ ] Session leak detection alert
  - [ ] Document alerting setup

### 8.3 Operational Concerns
> **Priority**: P2 - Production
> **Component**: Infrastructure

- [ ] **8.3.1** Add systemd service file
  - [ ] Create `terminar-server.service`
  - [ ] Add socket activation support
  - [ ] Add restart policy
  - [ ] Document installation

- [ ] **8.3.2** Add log rotation
  - [ ] Configure logrotate
  - [ ] Add log compression
  - [ ] Set retention policy

- [ ] **8.3.3** Add backup/restore
  - [ ] Document what to backup
  - [ ] Create backup script
  - [ ] Create restore script
  - [ ] Test disaster recovery

---

## Summary

### Priority Legend
- **P0**: Must fix before any deployment
- **P1**: Must fix before production deployment
- **P2**: Should fix for production quality
- **P3**: Nice to have

### Estimated Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| 1 | Week 1 | Critical bug fixes |
| 2 | Week 2 | Security hardening |
| 3 | Week 3 | Reliability & resilience |
| 4 | Week 4 | Code quality |
| 5 | Week 4-5 | Testing |
| 6 | Week 5-6 | Features & polish |
| 7 | Week 6 | Documentation & packaging |
| 8 | Week 6+ | Production readiness |

### Task Count Summary

> **Updated**: January 15, 2026 - Added 6 tasks discovered during code review

| Category | P0 | P1 | P2 | P3 | Total |
|----------|----|----|----|----|-------|
| Bug Fixes | 19 | 0 | 0 | 0 | 19 |
| Security | 5 | 12 | 0 | 0 | 17 |
| Reliability | 0 | 15 | 0 | 0 | 15 |
| Code Quality | 0 | 0 | 15 | 3 | 18 |
| Testing | 0 | 11 | 4 | 0 | 15 |
| Features | 0 | 0 | 16 | 0 | 16 |
| Documentation | 0 | 0 | 10 | 0 | 10 |
| Production | 0 | 0 | 11 | 0 | 11 |
| **Total** | **24** | **38** | **56** | **3** | **121** |

**New tasks added:**
- 1.1.4 (P0): Synchronize concurrent PTY access
- 1.5.3 (P0): Fix MockReader lock during blocking recv
- 2.1.5 (P0): Move token from query string to Authorization header
- 3.3.4 (P1): Fix broadcast subscriber leak
- 4.2.4 (P2): Implement missing terminar-protocol exports
- 6.2.5 (P2): Handle ServerController errors

---

## Appendix A: File Manifest

Files that need modification:

```
server/
├── Cargo.toml                 # Add dependencies (parking_lot, rustls)
├── src/
│   ├── main.rs               # Signal handling, TLS config
│   ├── lib.rs                # Major refactoring (extract handlers)
│   ├── session.rs            # Add Drop, state machine, writer storage
│   ├── pty.rs                # Fix mock implementation
│   ├── messages.rs           # Add new message types
│   ├── config.rs             # Add new CLI flags
│   ├── error.rs              # NEW: Structured errors
│   ├── constants.rs          # NEW: Configuration constants
│   └── handlers/             # NEW: Handler modules
│       ├── mod.rs
│       ├── session.rs
│       ├── io.rs
│       └── auth.rs
└── tests/
    ├── test_unix_socket.rs   # NEW
    ├── test_stress.rs        # NEW
    └── test_security.rs      # NEW

extension/
├── package.json              # Add settings contribution
├── tsconfig.json             # Enable strict mode
├── src/
│   ├── extension.ts          # Fix types, add deactivate
│   ├── SessionManager.ts     # Remove dev token, add reconnection
│   ├── NetSocketAdapter.ts   # Implement framed protocol
│   ├── SessionTreeProvider.ts # Fix types, add features
│   └── WebSocketAdapter.ts   # NEW: For remote connections
└── src/test/
    ├── reconnection.test.ts  # NEW
    └── negative.test.ts      # NEW

packages/terminar-protocol/
└── src/
    ├── messages.ts           # Fix schemas, add types
    ├── client.ts             # Track auth state, queue messages
    └── framing.ts            # NEW: Length-prefixed framing

web/
└── src/
    ├── App.svelte            # Connection state UI
    ├── components/
    │   └── Terminal.svelte   # Implement resize
    └── lib/
        └── WebSocketSessionManager.ts  # Use terminar-protocol
```

---

## Appendix B: Configuration Reference

### Server CLI Flags (Target)

```
terminar-server [OPTIONS] [COMMAND]

OPTIONS:
    --socket-path <PATH>      Unix socket path [default: /tmp/vscode-terminar-{UID}.sock]
    --http-port <PORT>        HTTP/WebSocket port [default: 3000]
    --tls-port <PORT>         HTTPS/WSS port [default: 3443]
    --cert <PATH>             TLS certificate path
    --key <PATH>              TLS private key path
    --cors-origin <ORIGIN>    Allowed CORS origins (repeatable)
    --history-size <BYTES>    Max history per session [default: 10485760]
    --persist-sessions        Enable session persistence
    --persist-history         Enable history persistence
    --log-level <LEVEL>       Log level [default: info]
    --log-file <PATH>         Log file path (stdout if not set)
    --log-json                Output logs as JSON

COMMANDS:
    pair                      Generate pairing code
    revoke <TOKEN>            Revoke authentication token
    generate-cert             Generate self-signed certificate
```

### VS Code Settings (Target)

```json
{
  "terminar.serverPath": "/usr/local/bin/terminar-server",
  "terminar.socketPath": "/tmp/my-shell.sock",
  "terminar.autoStart": true,
  "terminar.remoteHost": "",
  "terminar.logLevel": "info"
}
```
