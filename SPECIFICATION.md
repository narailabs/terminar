# terminar - System Specification

**Version**: 2.1
**Status**: Draft
**Last Updated**: January 16, 2026

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
4. [Components](#4-components)
5. [Protocol Specification](#5-protocol-specification)
6. [Security Model](#6-security-model)
7. [API Reference](#7-api-reference)
8. [Data Models](#8-data-models)
9. [Error Handling](#9-error-handling)
10. [Configuration](#10-configuration)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Glossary](#12-glossary)

---

## 1. Introduction

### 1.1 Purpose

The terminar System provides terminal sessions that survive application restarts, window closures, and system crashes. Users can disconnect from a session and reconnect later, finding their work exactly as they left it.

### 1.2 Goals

| Goal | Description |
|------|-------------|
| **Persistence** | Shell sessions survive client disconnections and crashes |
| **Multi-client** | Multiple clients can view/interact with the same session |
| **Multi-transport** | Support local (Unix socket) and remote (WebSocket) access |
| **Cross-platform** | VS Code extension, web browser, standalone Electron app |
| **Security** | Token-based authentication, optional TLS, secure pairing |

### 1.3 Non-Goals

- Full tmux/screen replacement (no window splitting, no detach command)
- Session sharing across different users (single-user only)
- Built-in SSH tunneling (use external tools)
- Terminal multiplexing within a single PTY

### 1.4 Terminology

| Term | Definition |
|------|------------|
| **Session** | A persistent PTY process with associated metadata and history |
| **Client** | Any frontend connecting to the server (extension, web, electron) |
| **Attach** | Connect to an existing session to view/interact with it |
| **Mirror** | Multiple clients viewing the same session simultaneously |
| **Steal** | Take exclusive control of a session, disconnecting others |

---

## 2. System Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  VS Code        │  Web Browser    │  Electron App               │
│  Extension      │  (Svelte)       │  (Future)                   │
└────────┬────────┴────────┬────────┴────────┬────────────────────┘
         │                 │                 │
         │ Unix Socket     │ WebSocket       │ WebSocket
         │ (localhost)     │ (remote)        │ (remote)
         │                 │                 │
         └────────────────┬┴─────────────────┘
                          │
              ┌───────────▼───────────┐
              │     RUST SERVER       │
              │  ┌─────────────────┐  │
              │  │ Session Manager │  │
              │  │ ┌─────┐ ┌─────┐ │  │
              │  │ │Sess1│ │Sess2│ │  │
              │  │ └──┬──┘ └──┬──┘ │  │
              │  └────┼───────┼────┘  │
              │       │       │       │
              │  ┌────▼───────▼────┐  │
              │  │   PTY Manager   │  │
              │  │ ┌─────┐ ┌─────┐ │  │
              │  │ │/bash│ │/zsh │ │  │
              │  │ └─────┘ └─────┘ │  │
              │  └─────────────────┘  │
              └───────────────────────┘
```

### 2.2 Data Flow

```
User Input → Client → Transport → Server → Session → PTY → Shell
                                                         ↓
User Display ← Client ← Transport ← Server ← Session ← Output
```

### 2.3 Session Lifecycle

```
┌─────────┐    create     ┌─────────┐    shell exit    ┌────────┐
│ (none)  │ ────────────► │ Running │ ───────────────► │ Closed │
└─────────┘               └─────────┘                  └────────┘
                               │                            │
                               │ error                      │
                               ▼                            │
                          ┌─────────┐                       │
                          │  Error  │ ──────────────────────┘
                          └─────────┘        cleanup
```

---

## 3. Architecture

### 3.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          SERVER                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Unix Socket  │  │  HTTP/WS     │  │  Auth Middleware     │  │
│  │  Listener    │  │  Server      │  │  ├─ Token validation │  │
│  │              │  │  (Axum)      │  │  └─ Rate limiting    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └────────────┬────┴──────────────────────┘              │
│                      │                                          │
│              ┌───────▼───────┐                                  │
│              │ Message Router │                                  │
│              └───────┬───────┘                                  │
│                      │                                          │
│    ┌─────────────────┼─────────────────┐                       │
│    │                 │                 │                       │
│    ▼                 ▼                 ▼                       │
│  ┌─────────┐   ┌──────────┐   ┌────────────┐                  │
│  │ Session │   │   I/O    │   │   Auth     │                  │
│  │ Handler │   │ Handler  │   │  Handler   │                  │
│  │         │   │          │   │            │                  │
│  │ • list  │   │ • input  │   │ • auth     │                  │
│  │ • create│   │ • resize │   │ • pair     │                  │
│  │ • kill  │   │ • attach │   │ • revoke   │                  │
│  │ • rename│   │          │   │            │                  │
│  └────┬────┘   └────┬─────┘   └────────────┘                  │
│       │             │                                          │
│       └──────┬──────┘                                          │
│              │                                                  │
│       ┌──────▼──────┐                                          │
│       │ SessionMap  │  Arc<Mutex<HashMap<String, Session>>>    │
│       └──────┬──────┘                                          │
│              │                                                  │
│       ┌──────▼──────┐                                          │
│       │   Session   │                                          │
│       │  ┌───────┐  │                                          │
│       │  │ PTY   │  │  Master/Slave PTY pair                   │
│       │  ├───────┤  │                                          │
│       │  │History│  │  Circular buffer (10MB default)          │
│       │  ├───────┤  │                                          │
│       │  │Output │  │  Broadcast channel                       │
│       │  │  Tx   │  │                                          │
│       │  └───────┘  │                                          │
│       └─────────────┘                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Threading Model

| Component | Thread Type | Purpose |
|-----------|-------------|---------|
| Main | Tokio runtime | Async task coordination |
| HTTP Server | Tokio tasks | Handle HTTP/WebSocket connections |
| Unix Socket | Tokio tasks | Handle local connections |
| PTY Reader | `spawn_blocking` | Read from PTY (blocking I/O) |
| Client Writer | Tokio tasks | Write to connected clients |

### 3.3 Concurrency Model

```rust
// Shared state structure
struct AppState {
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    api_key: String,
    pairing_codes: Arc<Mutex<HashMap<String, (String, Instant)>>>,
}

// Session structure
struct Session {
    id: String,
    name: String,
    shell: String,
    cwd: String,
    created_at: DateTime<Utc>,
    state: SessionState,
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    history: Arc<Mutex<CircularBuffer<u8>>>,
    output_tx: broadcast::Sender<SessionEvent>,
    reader_handle: Option<JoinHandle<()>>,
}
```

### 3.4 Threading Hazards

> The following concurrency issues were identified during initial development. Most have been resolved.

| Hazard | Status | Resolution |
|--------|--------|------------|
| **Blocking thread in async context** | ✅ Fixed | PTY reader uses `tokio::spawn_blocking()` |
| **Concurrent PTY access** | ✅ Fixed | PTY master wrapped in `Arc<parking_lot::Mutex<>>`, writer cached separately |
| **MockReader deadlock** | ✅ Fixed | Lock released before blocking `recv()` |
| **Thread handle leak** | ✅ Fixed | `reader_handle` stored in `Session` struct, aborted in `Drop` |
| **Subscriber leak** | ✅ Fixed | `Session::Drop` aborts reader and logs subscriber count |
| **Mutex poisoning** | ✅ Fixed | All mutexes use `parking_lot::Mutex` (non-poisoning) |
| **Task abort without await** | Open | WebSocket tasks still use `abort()` |

---

## 4. Components

### 4.1 Rust Server

**Location**: `server/`

**Responsibilities**:
- Manage PTY sessions (create, attach, kill)
- Handle multiple concurrent clients per session
- Broadcast output to all attached clients
- Buffer history for replay on attach
- Authenticate clients via tokens
- Generate and validate pairing codes

**Key Files**:
| File | Purpose |
|------|---------|
| `main.rs` | CLI entry point, server startup |
| `lib.rs` | Core server logic, message routing, health endpoint |
| `session.rs` | Session struct and state machine |
| `messages.rs` | Protocol message types |
| `pty.rs` | PTY abstraction (real + mock) |
| `history.rs` | CircularBuffer for bounded history (10MB default) |
| `error.rs` | Structured error types (ServerError enum) |
| `config.rs` | Server configuration (future) |
| `handlers/` | Message handler implementations |

### 4.2 Shell Protocol Library

**Location**: `packages/terminar-protocol/`

**Responsibilities**:
- Define typed message schemas (Zod)
- Provide `ShellClient` class for all frontends
- Handle message framing (length-prefixed)
- Abstract transport (Unix socket, WebSocket)

> ⚠️ **IMPLEMENTATION STATUS**: Currently only exports `VERSION`. Framing functions and message schemas are NOT YET exported from the package.

**Exports** (Target):
```typescript
// Types
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

// Classes
export class ShellClient extends EventEmitter { ... }
export interface IShellSocket { ... }

// Utilities
export function frameMessage(data: string): Buffer;
export function parseFrame(buffer: Buffer): { message: string, remaining: Buffer } | null;
```

### 4.3 VS Code Extension

**Location**: `extension/`

**Responsibilities**:
- Integrate with VS Code terminal API
- Manage connection to local server
- Auto-start server if not running
- Provide TreeView for session management
- Support remote connections (future)

**Key Classes**:
| Class | Purpose |
|-------|---------|
| `SessionManager` | Wraps ShellClient, manages socket connection |
| `NetSocketAdapter` | Unix socket → IShellSocket adapter |
| `ServerController` | Spawns/monitors server process |
| `SessionTreeProvider` | VS Code TreeView data provider |
| `Terminar` | Custom PTY for VS Code terminal |

### 4.4 Web Frontend

**Location**: `web/`

**Responsibilities**:
- Provide browser-based terminal access
- Connect via WebSocket to remote server
- Render terminal using xterm.js
- Handle authentication and session management

**Key Files**:
| File | Purpose |
|------|---------|
| `App.svelte` | Main app, login, session list |
| `Terminal.svelte` | xterm.js terminal component |
| `WebSocketSessionManager.ts` | WebSocket connection management |

---

## 5. Protocol Specification

### 5.1 Transport Layer

#### 5.1.1 Unix Socket (Local)

- **Path**: `/tmp/vscode-terminar-{UID}.sock`
- **Format**: Length-prefixed JSON frames
  > ⚠️ **IMPLEMENTATION STATUS**: Currently uses newline-delimited framing (v1). Length-prefixed framing (v2) is the target but NOT YET IMPLEMENTED. See Section 5.7 for migration plan.
- **Frame Structure** (Target v2):
  ```
  ┌─────────────────┬──────────────────────┐
  │  Length (4 bytes, big-endian)          │
  ├─────────────────┴──────────────────────┤
  │  JSON Payload (UTF-8)                  │
  └────────────────────────────────────────┘
  ```
- **Frame Structure** (Current v1):
  ```
  ┌──────────────────────────────┬────┐
  │  JSON Payload (UTF-8)        │ \n │
  └──────────────────────────────┴────┘
  ```
  > ⚠️ **BUG**: v1 framing corrupts JSON messages containing embedded newlines.

#### 5.1.2 WebSocket (Remote)

- **Endpoint**: `ws[s]://host:port/ws?token={token}`
  > ⚠️ **SECURITY NOTE**: Token in query string is visible in browser history and server logs. Prefer `Authorization: Bearer` header (server supports both). Web frontend currently uses query string method.
- **Format**: WebSocket text frames containing JSON
- **Subprotocol**: `terminar-v2`

### 5.2 Message Format

All messages are JSON objects with a `type` field for discrimination.

#### 5.2.1 Client → Server Messages

```typescript
// Authentication
{ "type": "auth", "token": string }

// Session Management
{ "type": "list_sessions" }
{
  "type": "create_session",
  "cwd": string,           // Working directory
  "shell": string,         // Shell path (e.g., "/bin/bash")
  "env": Record<string, string>,  // Environment variables
  "cols": number,          // Terminal columns (1-500)
  "rows": number           // Terminal rows (1-500)
}
{ "type": "kill_session", "session_id": string }
{ "type": "rename_session", "session_id": string, "new_name": string }

// Session I/O
{ "type": "attach", "session_id": string, "mode": "mirror" | "steal" }
{ "type": "detach", "session_id": string }
{ "type": "input", "session_id": string, "data": string }
{ "type": "resize", "session_id": string, "cols": number, "rows": number }

// Pairing
{ "type": "pair_request" }
```

#### 5.2.2 Server → Client Messages

```typescript
// Session Events
{
  "type": "SessionList",
  "sessions": SessionInfo[]
}
{
  "type": "SessionCreated",
  "session": SessionInfo
}
{ "type": "SessionClosed", "session_id": string, "exit_code": number | null }
{ "type": "SessionRenamed", "session_id": string, "new_name": string }

// I/O Events
{ "type": "Output", "session_id": string, "data": string }
{ "type": "HistoryReplay", "session_id": string, "data": string }

// Client Events
{ "type": "ClientJoined", "session_id": string, "client_id": string }
{ "type": "ClientLeft", "session_id": string, "client_id": string }
{ "type": "ForceDisconnect", "session_id": string, "reason": string }

// Auth Events
{ "type": "AuthSuccess" }
{ "type": "AuthFailure", "reason": string }
{ "type": "PairResponse", "code": string, "expiry_secs": number }

// Errors
{ "type": "Error", "code": string, "message": string, "session_id"?: string }

// System Events
{ "type": "Shutdown", "reason": string, "timeout_secs": number }
```

### 5.3 Session Info Schema

```typescript
interface SessionInfo {
  id: string;           // UUID
  name: string;         // Display name
  shell: string;        // Shell path
  cwd: string;          // Working directory
  created_at: string;   // ISO 8601 timestamp
  state: "running" | "closed" | "error";
  attached_clients: number;
}
```

### 5.4 Error Codes

| Code | Meaning |
|------|---------|
| `AUTH_REQUIRED` | No token provided |
| `AUTH_INVALID` | Invalid or expired token |
| `AUTH_RATE_LIMITED` | Too many auth attempts |
| `SESSION_NOT_FOUND` | Session ID doesn't exist |
| `SESSION_CLOSED` | Session has terminated |
| `INVALID_SHELL` | Shell not in whitelist |
| `INVALID_CWD` | Working directory doesn't exist |
| `INVALID_DIMENSIONS` | Cols/rows out of range |
| `PAIRING_EXPIRED` | Pairing code has expired |
| `PAIRING_INVALID` | Pairing code is wrong |
| `INTERNAL_ERROR` | Unexpected server error |
| `SESSION_INPUT_FAILED` | Write to PTY failed |
| `INTERNAL_PTY_ERROR` | PTY layer error |
| `CONNECTION_TIMEOUT` | Client didn't auth in time |

### 5.5 Connection Flow

```
Client                                    Server
   │                                         │
   │  ─────── Connect (WS or Unix) ───────►  │
   │                                         │
   │  ◄────── (Connection established) ────  │
   │                                         │
   │  ─────── { type: "auth", token } ────►  │
   │                                         │
   │  ◄────── { type: "AuthSuccess" } ─────  │
   │                                         │
   │  ─────── { type: "list_sessions" } ──►  │
   │                                         │
   │  ◄────── { type: "SessionList" } ─────  │
   │                                         │
   │  ─────── { type: "attach", ... } ────►  │
   │                                         │
   │  ◄────── { type: "HistoryReplay" } ───  │
   │  ◄────── { type: "Output" } ──────────  │
   │  ◄────── { type: "Output" } ──────────  │
   │  ...                                    │
```

### 5.6 Pairing Flow

```
Host CLI                   Server                    Remote Client
   │                          │                           │
   │ ─── pair_request ──────► │                           │
   │                          │                           │
   │ ◄── PairResponse ─────── │                           │
   │     (code: "12345678")   │                           │
   │                          │                           │
   │  [User tells code        │                           │
   │   to remote user]        │                           │
   │                          │                           │
   │                          │ ◄── POST /pair/exchange ─ │
   │                          │     { code: "12345678" }  │
   │                          │                           │
   │                          │ ─── { token: "..." } ───► │
   │                          │                           │
   │                          │ ◄── Connect with token ── │
   │                          │                           │
```

### 5.7 Protocol Migration (v1 → v2)

> **Status**: v1 (newline-delimited) is current; v2 (length-prefixed) is target.

#### 5.7.1 Version Negotiation

Clients should negotiate protocol version in handshake:

```
Client                                    Server
   │                                         │
   │  ─── { type: "handshake",              │
   │        protocol_version: 2 } ────────►  │
   │                                         │
   │  ◄── { type: "HandshakeAck",           │
   │        protocol_version: 2,             │
   │        server_version: "1.0.0" } ─────  │
   │                                         │
   │  (Switch to v2 framing)                 │
```

If server doesn't support requested version, it responds with highest supported version.

#### 5.7.2 Migration Strategy

1. **Phase 1**: Server supports both v1 and v2, defaults to v1
2. **Phase 2**: Clients updated to request v2
3. **Phase 3**: Server defaults to v2, still supports v1
4. **Phase 4**: v1 deprecated with warning
5. **Phase 5**: v1 removed

#### 5.7.3 Backward Compatibility

During transition, servers should:
- Accept connections without handshake (assume v1)
- Log warnings when v1 framing is used
- Track v1 vs v2 client metrics

---

## 6. Security Model

### 6.1 Authentication

#### 6.1.1 Local (Unix Socket)

- Relies on OS file permissions
- Socket created with mode `0600` (owner only)
- No application-level auth required (optional)

#### 6.1.2 Remote (WebSocket)

- Required: Bearer token in query string or header
- Token: Server-generated UUID on startup
- Validation: Exact match against `api_key`

### 6.2 Token Management

#### 6.2.1 Auto Token File (Local Clients)

The server writes the authentication token to `~/.terminar/token` on startup. Local clients (VS Code extension) read this file automatically.

```
┌─────────────────────────────────────────────────────────┐
│                AUTO TOKEN FILE FLOW                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Server Startup                                          │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────────┐                                    │
│  │ Generate API_KEY │  (UUID v4)                        │
│  └────────┬────────┘                                    │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────────────────────────┐               │
│  │ Write to ~/.terminar/token  │               │
│  │ (mode 0600 - owner read/write only) │               │
│  └────────┬────────────────────────────┘               │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────────────────────────┐               │
│  │ VS Code Extension / Local Client    │               │
│  │ reads token file automatically      │               │
│  └────────┬────────────────────────────┘               │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────┐                                    │
│  │ Client connects │                                    │
│  │   with token    │                                    │
│  └─────────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Token File Location**: `~/.terminar/token`

**Security**:
- File permissions: `0600` (owner read/write only)
- Directory permissions: `0700` (owner access only)
- Token is a UUID v4 (128 bits of entropy)

#### 6.2.2 Remote Token Exchange

For remote clients (web browser), use the pairing flow:

```
┌─────────────────────────────────────────────────────────┐
│                    TOKEN LIFECYCLE                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Server Startup                                          │
│       │                                                  │
│       ▼                                                  │
│  ┌─────────────────┐                                    │
│  │ Generate API_KEY │  (UUID v4, logged to console)     │
│  └────────┬────────┘                                    │
│           │                                              │
│           ▼                                              │
│  ┌─────────────────┐      ┌─────────────────┐          │
│  │   Direct Use    │  OR  │  Pairing Flow   │          │
│  │ (copy from log) │      │ (6-8 digit code)│          │
│  └────────┬────────┘      └────────┬────────┘          │
│           │                        │                    │
│           └────────────┬───────────┘                    │
│                        │                                │
│                        ▼                                │
│               ┌─────────────────┐                       │
│               │ Client connects │                       │
│               │   with token    │                       │
│               └────────┬────────┘                       │
│                        │                                │
│                        ▼                                │
│               ┌─────────────────┐                       │
│               │ Token validated │                       │
│               │  (exact match)  │                       │
│               └─────────────────┘                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 6.3 Pairing Codes

| Property | Value |
|----------|-------|
| Length | 8 digits (alphanumeric optional) |
| Validity | 5 minutes (300 seconds) |
| Max attempts | 5 per IP per 15 minutes |
| Lockout | 15 minutes after max attempts |

### 6.4 Input Validation

#### 6.4.1 Shell Whitelist

```
/bin/bash
/bin/sh
/bin/zsh
/usr/bin/fish
/usr/local/bin/bash
/usr/local/bin/zsh
/usr/local/bin/fish
```

Configurable via `--shell-whitelist` flag.

#### 6.4.2 Environment Variable Blocklist

```
LD_PRELOAD
LD_LIBRARY_PATH
DYLD_*
PATH (modified, not blocked)
HOME (modified, not blocked)
```

#### 6.4.3 Terminal Dimensions

- Columns: 1-500 (default: 80)
- Rows: 1-500 (default: 24)
- Out-of-range values are clamped with warning

### 6.5 TLS Configuration

| Mode | Description |
|------|-------------|
| Off | Plain HTTP/WS (development only) |
| Self-signed | Generated certificate (first-run setup) |
| Custom | User-provided certificate and key |

---

## 7. API Reference

### 7.1 REST Endpoints

#### GET /health

Health check endpoint (implemented in `lib.rs`).

**Response**:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime_secs": 3600,
  "sessions": 5
}
```

**Rust Implementation**:
```rust
#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_secs: u64,
    sessions: usize,
}
```

#### POST /pair/exchange

Exchange pairing code for auth token.

**Request**:
```json
{ "code": "12345678" }
```

**Response (Success)**:
```json
{ "token": "550e8400-e29b-41d4-a716-446655440000" }
```

**Response (Error)**:
```json
{ "error": "PAIRING_INVALID", "message": "Invalid pairing code" }
```

#### POST /auth/revoke

Revoke an authentication token.

**Headers**: `Authorization: Bearer {admin_token}`

**Request**:
```json
{ "token": "token-to-revoke" }
```

### 7.2 WebSocket Endpoint

#### GET /ws

Upgrade to WebSocket connection.

**Query Parameters**:
- `token` (required): Authentication token

**Headers** (alternative):
- `Authorization: Bearer {token}`

---

## 8. Data Models

### 8.1 Session

> ⚠️ **IMPLEMENTATION STATUS**: The struct below describes the TARGET state. See notes for current implementation gaps.

```rust
pub struct Session {
    /// Unique identifier (UUID)
    pub id: String,

    /// Human-readable name
    pub name: String,

    /// Shell executable path
    pub shell: String,

    /// Working directory
    pub cwd: String,

    /// Creation timestamp
    pub created_at: DateTime<Utc>,

    /// Current state
    pub state: SessionState,

    /// PTY master handle
    pub master: Box<dyn MasterPty + Send>,

    /// PTY writer (for input)
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    // ⚠️ NOT IMPLEMENTED: Currently uses take_writer() pattern which breaks input after first use

    /// Output history buffer (10MB default, bounded)
    pub history: Arc<Mutex<CircularBuffer>>,
    // ✅ IMPLEMENTED: Phase 1 - CircularBuffer in server/src/history.rs

    /// Broadcast channel for output
    pub output_tx: broadcast::Sender<SessionEvent>,

    /// Background reader task handle
    pub reader_handle: Option<JoinHandle<()>>,

    /// Number of attached clients
    pub attached_count: AtomicUsize,
}
```

### 8.2 Session State

```rust
pub enum SessionState {
    /// PTY is being created
    Creating,

    /// Shell is running
    Running,

    /// Shell exited normally
    Closed { exit_code: i32 },

    /// Shell exited with error
    Error { message: String },
}
```

### 8.3 Session Event

```rust
pub enum SessionEvent {
    /// New output from shell
    Output(String),

    /// Shell has exited
    Closed { exit_code: Option<i32> },

    /// Error occurred
    Error(String),
}
```

---

## 9. Error Handling

### 9.1 Rust Error Types

The server uses structured error types via `thiserror` (in `server/src/error.rs`):

```rust
#[derive(Error, Debug)]
pub enum ServerError {
    /// Session with the given ID was not found.
    #[error("session not found: {0}")]
    SessionNotFound(String),

    /// Authentication failed (invalid or expired token).
    #[error("authentication failed")]
    AuthFailed,

    /// PTY-related error.
    #[error("PTY error: {0}")]
    PtyError(String),

    /// WebSocket communication error.
    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    /// Message serialization/deserialization error.
    #[error("protocol error: {0}")]
    ProtocolError(String),

    /// Rate limit exceeded.
    #[error("rate limit exceeded")]
    RateLimitExceeded,

    /// Invalid input provided.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Internal server error.
    #[error("internal error: {0}")]
    Internal(String),
}
```

**Helper Methods**:
- `ServerError::session_not_found(id)` - Create SessionNotFound error
- `ServerError::pty(msg)` - Create PTY error
- `ServerError::protocol(msg)` - Create protocol error
- `ServerError::invalid_input(msg)` - Create invalid input error

**Conversions**:
- `From<serde_json::Error>` → `ProtocolError`
- `From<std::io::Error>` → `Internal`

### 9.2 Error Categories

| Category | Handling |
|----------|----------|
| **Connection** | Reconnect with backoff |
| **Authentication** | Re-prompt for credentials |
| **Session** | Display error, allow retry |
| **Protocol** | Log and ignore malformed messages |
| **Internal** | Log, notify user, continue if possible |

### 9.2 Reconnection Strategy

```
Attempt 1: Wait 1s
Attempt 2: Wait 2s
Attempt 3: Wait 4s
Attempt 4: Wait 8s
Attempt 5: Wait 16s
Attempt 6+: Wait 30s (max)

Add jitter: random(0-500ms)
Max attempts: 10 (configurable)
```

### 9.3 Client Error Display

```typescript
interface ErrorDisplay {
  // User-friendly message
  message: string;

  // Technical details (collapsible)
  details?: string;

  // Available actions
  actions: Array<{
    label: string;
    handler: () => void;
  }>;
}
```

---

## 10. Configuration

### 10.1 Server CLI

```
terminar-server [OPTIONS] [COMMAND]

OPTIONS:
    --socket-path <PATH>        Unix socket path
                                [default: /tmp/vscode-terminar-{UID}.sock]

    --http-port <PORT>          HTTP/WebSocket port [default: 3000]

    --tls-port <PORT>           HTTPS/WSS port [default: 3443]

    --cert <PATH>               TLS certificate file

    --key <PATH>                TLS private key file

    --cors-origin <ORIGIN>      Allowed CORS origins (repeatable)
                                [default: http://localhost:*]

    --shell-whitelist <SHELL>   Allowed shells (repeatable)
                                [default: /bin/bash,/bin/sh,/bin/zsh]

    --history-size <BYTES>      Max history per session
                                [default: 10485760 (10MB)]

    --pairing-code-length <N>   Pairing code length [default: 8]

    --pairing-ttl <SECS>        Pairing code validity [default: 300]

    --log-level <LEVEL>         Log level [default: info]
                                [values: trace, debug, info, warn, error]

    --log-file <PATH>           Log file path (stdout if not set)

    --log-json                  Output logs as JSON

COMMANDS:
    pair                        Generate pairing code
    revoke <TOKEN>              Revoke authentication token
    generate-cert               Generate self-signed certificate
    list-sessions               List active sessions
```

### 10.2 VS Code Extension Settings

```json
{
  "terminar.serverPath": {
    "type": "string",
    "default": "",
    "description": "Path to server binary (auto-detect if empty)"
  },
  "terminar.socketPath": {
    "type": "string",
    "default": "",
    "description": "Unix socket path (auto-detect if empty)"
  },
  "terminar.autoStartServer": {
    "type": "boolean",
    "default": true,
    "description": "Automatically start server if not running"
  },
  "terminar.reconnectAttempts": {
    "type": "number",
    "default": 10,
    "description": "Max reconnection attempts"
  },
  "terminar.logLevel": {
    "type": "string",
    "enum": ["error", "warn", "info", "debug"],
    "default": "info"
  }
}
```

---

## 11. Non-Functional Requirements

### 11.1 Performance

| Metric | Target |
|--------|--------|
| Message latency (local) | < 5ms p99 |
| Message latency (remote) | < 50ms p99 (network dependent) |
| Session creation time | < 100ms |
| Memory per session (idle) | < 1MB |
| Memory per session (10MB history) | < 15MB |
| Concurrent sessions | 100+ |
| Concurrent clients per session | 10+ |

### 11.2 Reliability

| Metric | Target |
|--------|--------|
| Server uptime | 99.9% |
| Graceful shutdown time | < 30s |
| Reconnection success rate | > 95% |
| Data loss on crash | 0 (history buffered) |

### 11.3 Scalability

| Dimension | Approach |
|-----------|----------|
| Sessions | Horizontal (memory-bound) |
| Clients | Async I/O (not thread-per-client) |
| History | Circular buffer (bounded) |
| Connections | OS file descriptor limits |

---

## 12. Glossary

| Term | Definition |
|------|------------|
| **PTY** | Pseudo-terminal, a pair of virtual devices providing terminal functionality |
| **Master** | The controlling side of a PTY (server reads/writes here) |
| **Slave** | The terminal side of a PTY (shell attaches here) |
| **Broadcast Channel** | Tokio channel allowing multiple receivers for the same sender |
| **Circular Buffer** | Fixed-size buffer that overwrites oldest data when full |
| **Framing** | Adding length prefix to messages for reliable parsing |
| **Pairing** | Process of establishing trust between remote client and server |
| **Mirror Mode** | Multiple clients viewing same session simultaneously |
| **Steal Mode** | Taking exclusive control of a session |

---

## Appendix A: CircularBuffer Implementation

The `CircularBuffer` (`server/src/history.rs`) provides bounded memory for session history.

### A.1 Design

```rust
pub struct CircularBuffer {
    data: Box<[u8]>,      // Fixed-size heap allocation
    capacity: usize,      // Maximum buffer size
    write_pos: usize,     // Current write position
    len: usize,           // Current data length (0..capacity)
}
```

### A.2 API

```rust
impl CircularBuffer {
    /// Create a new circular buffer with the given capacity
    pub fn new(capacity: usize) -> Self;

    /// Push bytes into the buffer (overwrites oldest data when full)
    pub fn push(&mut self, bytes: &[u8]);

    /// Get current length of data in buffer
    pub fn len(&self) -> usize;

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool;

    /// Check if buffer is full
    pub fn is_full(&self) -> bool;

    /// Get buffer capacity
    pub fn capacity(&self) -> usize;

    /// Clear all data from buffer
    pub fn clear(&mut self);

    /// Convert buffer contents to Vec<u8> (for replay)
    pub fn to_vec(&self) -> Vec<u8>;
}
```

### A.3 Behavior

| Scenario | Result |
|----------|--------|
| Empty buffer | `to_vec()` returns empty Vec |
| Push < capacity | Data stored, `len()` increases |
| Push = capacity | Buffer full, `to_vec()` returns all data |
| Push > capacity | Oldest data overwritten, newest data kept |
| Multiple pushes | Data concatenated, wraps around buffer |

### A.4 Default Configuration

| Setting | Value |
|---------|-------|
| Default capacity | 10 MB (10,485,760 bytes) |
| Minimum capacity | 1 KB (1,024 bytes) |
| Maximum capacity | 1 GB (configurable) |

### A.5 Memory Safety

- Uses `Box<[u8]>` for fixed heap allocation
- No reallocations after construction
- Safe wrapping via modular arithmetic
- Zero-copy reads where possible

---

## Appendix B: Message Schema (Zod)

```typescript
import { z } from 'zod';

// Session Info
export const SessionInfoSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  shell: z.string(),
  cwd: z.string(),
  created_at: z.string().datetime(),
  state: z.enum(['running', 'closed', 'error']),
  attached_clients: z.number().int().min(0),
});

// Client Messages
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('list_sessions') }),
  z.object({
    type: z.literal('create_session'),
    cwd: z.string(),
    shell: z.string(),
    env: z.record(z.string()).optional().default({}),
    cols: z.number().int().min(1).max(500).default(80),
    rows: z.number().int().min(1).max(500).default(24),
  }),
  z.object({ type: z.literal('kill_session'), session_id: z.string().uuid() }),
  z.object({
    type: z.literal('rename_session'),
    session_id: z.string().uuid(),
    new_name: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('attach'),
    session_id: z.string().uuid(),
    mode: z.enum(['mirror', 'steal']).default('mirror'),
  }),
  z.object({ type: z.literal('detach'), session_id: z.string().uuid() }),
  z.object({
    type: z.literal('input'),
    session_id: z.string().uuid(),
    data: z.string(),
  }),
  z.object({
    type: z.literal('resize'),
    session_id: z.string().uuid(),
    cols: z.number().int().min(1).max(500),
    rows: z.number().int().min(1).max(500),
  }),
  z.object({ type: z.literal('pair_request') }),
]);

// Server Messages
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SessionList'), sessions: z.array(SessionInfoSchema) }),
  z.object({ type: z.literal('SessionCreated'), session: SessionInfoSchema }),
  z.object({
    type: z.literal('SessionClosed'),
    session_id: z.string().uuid(),
    exit_code: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('SessionRenamed'),
    session_id: z.string().uuid(),
    new_name: z.string(),
  }),
  z.object({ type: z.literal('Output'), session_id: z.string().uuid(), data: z.string() }),
  z.object({ type: z.literal('HistoryReplay'), session_id: z.string().uuid(), data: z.string() }),
  z.object({ type: z.literal('ClientJoined'), session_id: z.string().uuid(), client_id: z.string() }),
  z.object({ type: z.literal('ClientLeft'), session_id: z.string().uuid(), client_id: z.string() }),
  z.object({ type: z.literal('ForceDisconnect'), session_id: z.string().uuid(), reason: z.string() }),
  z.object({ type: z.literal('AuthSuccess') }),
  z.object({ type: z.literal('AuthFailure'), reason: z.string() }),
  z.object({ type: z.literal('PairResponse'), code: z.string(), expiry_secs: z.number() }),
  z.object({
    type: z.literal('Error'),
    code: z.string(),
    message: z.string(),
    session_id: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal('Shutdown'), reason: z.string(), timeout_secs: z.number() }),
]);

// Type exports
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
```

---

## Appendix C: Framing Protocol

### Length-Prefixed Framing

```
┌─────────────────────────────────────────────────────────────┐
│                      FRAME FORMAT                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Offset 0-3: Length (4 bytes, big-endian, unsigned)        │
│   Offset 4+:  Payload (UTF-8 JSON)                          │
│                                                              │
│   ┌─────────┬─────────┬─────────┬─────────┬────────────┐   │
│   │ Len[0]  │ Len[1]  │ Len[2]  │ Len[3]  │  Payload   │   │
│   │ (MSB)   │         │         │ (LSB)   │  (JSON)    │   │
│   └─────────┴─────────┴─────────┴─────────┴────────────┘   │
│                                                              │
│   Example: {"type":"auth","token":"abc"}                    │
│   Length: 30 bytes = 0x0000001E                             │
│                                                              │
│   ┌────┬────┬────┬────┬────────────────────────────────┐   │
│   │0x00│0x00│0x00│0x1E│{"type":"auth","token":"abc"}   │   │
│   └────┴────┴────┴────┴────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Implementation (TypeScript)

```typescript
export function frameMessage(json: string): Buffer {
  const payload = Buffer.from(json, 'utf8');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function parseFrames(buffer: Buffer): { messages: string[], remaining: Buffer } {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (offset + 4 + length > buffer.length) {
      break; // Incomplete frame
    }
    const payload = buffer.slice(offset + 4, offset + 4 + length);
    messages.push(payload.toString('utf8'));
    offset += 4 + length;
  }

  return {
    messages,
    remaining: buffer.slice(offset),
  };
}
```

---

*End of Specification*
