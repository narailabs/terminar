# API Documentation

This document describes the protocol messages, REST endpoints, and communication formats used by the termiNar server.

## Table of Contents

- [Protocol Messages](#protocol-messages)
  - [Client Messages](#client-messages)
  - [Server Messages](#server-messages)
- [REST Endpoints](#rest-endpoints)
- [WebSocket Authentication](#websocket-authentication)
- [Unix Socket Framing](#unix-socket-framing)

---

## Protocol Messages

All messages are JSON-encoded and use a `type` field for discrimination. Client messages use `snake_case` for the type tag. Server messages use `PascalCase` for the type tag.

### Client Messages

#### Auth

Authenticates a WebSocket connection. Must be the first message sent on a non-local WebSocket connection.

```json
{
  "type": "auth",
  "token": "your-api-token-here"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string` | The API token (UUID) obtained from `~/.terminar/token` or via pairing |

#### ListSessions

Requests the list of all active sessions.

```json
{
  "type": "list_sessions"
}
```

No additional fields.

#### CreateSession

Creates a new terminal session with a PTY.

```json
{
  "type": "create_session",
  "cwd": "/home/user/project",
  "shell": "/bin/bash",
  "env": {
    "TERM": "xterm-256color",
    "LANG": "en_US.UTF-8"
  },
  "cols": 80,
  "rows": 24
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Working directory for the session. Empty or `"/"` defaults to `$HOME`. |
| `shell` | `string` | Shell binary path. Must be in the allowed whitelist. Empty defaults to `$SHELL`. |
| `env` | `object` | Environment variables (key-value string pairs). Dangerous variables are filtered. |
| `cols` | `u16` | Terminal width in columns (clamped to 1-500). |
| `rows` | `u16` | Terminal height in rows (clamped to 1-500). |

**Allowed shells:** `/bin/bash`, `/bin/sh`, `/bin/zsh`, `/usr/bin/fish`, `/usr/local/bin/bash`, `/usr/local/bin/zsh`, `/usr/local/bin/fish`, `/opt/homebrew/bin/bash`, `/opt/homebrew/bin/zsh`, `/opt/homebrew/bin/fish`.

**Blocked environment variables:** `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, `DYLD_FORCE_FLAT_NAMESPACE`, `DYLD_LIBRARY_PATH`, `DYLD_FRAMEWORK_PATH`.

#### Attach

Attaches to a session to receive its output. Replays the session history buffer first, then streams live output.

```json
{
  "type": "attach",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "mode": "mirror"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID of the session to attach to |
| `mode` | `string` | Attach mode (currently only `"mirror"` is implemented) |

#### Input

Sends keyboard input to a session's PTY.

```json
{
  "type": "input",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "data": "ls -la\r"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID of the target session |
| `data` | `string` | Raw input data (including control characters like `\r` for Enter) |

#### Resize

Resizes the terminal dimensions of a session.

```json
{
  "type": "resize",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "cols": 120,
  "rows": 40
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID of the target session |
| `cols` | `u16` | New terminal width (clamped to 1-500) |
| `rows` | `u16` | New terminal height (clamped to 1-500) |

#### RenameSession

Renames an existing session.

```json
{
  "type": "rename_session",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "new_name": "Production Server"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID of the session to rename |
| `new_name` | `string` | New display name for the session |

#### KillSession

Terminates a session and its PTY process.

```json
{
  "type": "kill_session",
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID of the session to terminate |

#### PairRequest

Requests a pairing code for remote client authentication. Typically sent over the Unix socket by the CLI `pair` subcommand.

```json
{
  "type": "pair_request"
}
```

No additional fields.

---

### Server Messages

#### SessionList

Returns the list of all active sessions. Sent in response to `ListSessions`, `CreateSession`, `RenameSession`, and `KillSession`.

```json
{
  "type": "SessionList",
  "sessions": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Terminal",
      "shell": "/bin/bash",
      "cwd": "/home/user",
      "started_at": "now"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `sessions` | `array` | List of `SessionInfo` objects |

**SessionInfo fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Session UUID |
| `name` | `string` | Display name |
| `shell` | `string` | Shell binary path |
| `cwd` | `string` | Working directory |
| `started_at` | `string` | When the session was created |

#### Output

Terminal output data from a session. Sent when attached to a session.

```json
{
  "type": "Output",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "data": "user@host:~$ "
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | Source session UUID |
| `data` | `string` | Terminal output data (may contain ANSI escape sequences) |

#### SessionClosed

Indicates that a session has been closed (either killed or the shell exited).

```json
{
  "type": "SessionClosed",
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | `string` | UUID of the closed session |

#### Error

An error occurred while processing a client message.

```json
{
  "type": "Error",
  "message": "Session 'abc-123' not found"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `message` | `string` | Human-readable error description |

#### PairResponse

Response to a `PairRequest` with a generated pairing code.

```json
{
  "type": "PairResponse",
  "code": "84729361",
  "expiry_secs": 300
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | `string` | 8-digit numeric pairing code |
| `expiry_secs` | `u64` | Seconds until the code expires (default: 300) |

#### Shutdown

Sent to connected clients when the server is shutting down gracefully.

```json
{
  "type": "Shutdown",
  "reason": "Server shutting down"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `reason` | `string` | Human-readable shutdown reason |

---

## REST Endpoints

### GET /health

Health check endpoint. Unauthenticated.

**Response** (200 OK):

```json
{
  "status": "ok",
  "sessions": 3,
  "version": "0.1.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | Always `"ok"` |
| `sessions` | `number` | Number of active sessions |
| `version` | `string` | Server version from Cargo.toml |

### GET /metrics

Prometheus-style metrics endpoint. Requires `Authorization: Bearer <token>` header.

**Response** (200 OK, `text/plain; version=0.0.4`):

```
# HELP sessions_active Number of currently active terminal sessions
# TYPE sessions_active gauge
sessions_active 3
# HELP sessions_total_created Total number of sessions created since server start
# TYPE sessions_total_created counter
sessions_total_created 15
# HELP uptime_seconds Server uptime in seconds
# TYPE uptime_seconds counter
uptime_seconds 3600
# HELP session_broadcast_subscribers Total active broadcast subscribers across all sessions
# TYPE session_broadcast_subscribers gauge
session_broadcast_subscribers 5
```

### POST /pair/exchange

Exchanges a pairing code for an API token. Unauthenticated but rate-limited.

**Request:**

```json
{
  "code": "84729361"
}
```

**Response** (200 OK):

```json
{
  "token": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Error responses:**

| Status | Description |
|--------|-------------|
| 400 | Invalid request body or JSON |
| 404 | Invalid or expired pairing code |
| 429 | Rate limit exceeded (exponential backoff with hard lockout after 5 attempts per 15 minutes) |

### POST /auth/revoke

Revokes a token so it can no longer be used for authentication. Requires `Authorization: Bearer <token>` header.

**Request:**

```json
{
  "token": "token-to-revoke"
}
```

**Response** (200 OK):

```json
{
  "status": "revoked"
}
```

### GET /settings

Retrieve terminal settings. Unauthenticated (managed by CORS for local connections).

**Response** (200 OK): Returns the current `TerminalSettings` object.

### PUT /settings

Update terminal settings. Unauthenticated (managed by CORS for local connections).

**Request:** A `TerminalSettings` JSON object.

**Response** (200 OK): Returns the saved `TerminalSettings` object.

### GET /workspace

Retrieve workspace state. Unauthenticated (managed by CORS for local connections).

**Response** (200 OK): Returns the current `WorkspaceState` object.

### PUT /workspace

Update workspace state. Unauthenticated (managed by CORS for local connections).

**Request:** A `WorkspaceState` JSON object.

**Response** (200 OK): Returns the saved `WorkspaceState` object.

---

## WebSocket Authentication

WebSocket connections are made to `ws://<host>:<port>/ws`.

### Local connections

Connections from `127.0.0.1`, `::1`, or `localhost` skip authentication entirely. The server detects local connections via the socket peer address.

### Remote connections

Remote WebSocket clients must authenticate by sending an `Auth` message as the very first message after the WebSocket handshake:

```json
{
  "type": "auth",
  "token": "your-api-token"
}
```

**Flow:**

1. Client opens WebSocket connection to `/ws`.
2. Client sends `Auth` message with the API token.
3. Server validates the token.
   - If valid: connection proceeds, client can send any protocol message.
   - If invalid: server sends an `Error` message and closes the connection.
   - If no `Auth` within 30 seconds: server closes the connection.

**Obtaining a token:**

- **Local**: Read from `~/.terminar/token` (written on server startup with `0600` permissions).
- **Remote**: Use the pairing flow -- run `terminar-server pair` on the host, then POST the code to `/pair/exchange` to get a token.

### Auth bypass

The `--no-auth` flag disables all authentication. This is intended for development only.

### Token revocation

Revoke a token via `POST /auth/revoke`. Revoked tokens are rejected on subsequent WebSocket auth attempts and REST API calls.

---

## Unix Socket Framing

The Unix Domain Socket at `/tmp/vscode-terminar-<uid>.sock` uses **length-prefixed framing** to prevent protocol corruption.

### Frame format

```
+-------------------+-------------------+
| Length (4 bytes)   | JSON Payload      |
| big-endian u32     | (UTF-8 string)    |
+-------------------+-------------------+
```

1. **Length prefix**: 4 bytes in big-endian byte order, representing the length of the JSON payload in bytes.
2. **JSON payload**: The serialized `ClientMessage` or `ServerMessage` as a UTF-8 JSON string.

### Example

To send a `ListSessions` message:

```
JSON payload: {"type":"list_sessions"}
Payload length: 23 bytes

Wire bytes: [0x00, 0x00, 0x00, 0x17, 0x7B, 0x22, 0x74, 0x79, ...]
             ^--- length prefix ---^  ^--- JSON payload ----------^
```

### Maximum message size

Messages larger than 16 MB are rejected and the connection is closed.

### Reading responses

Responses use the same framing: read 4 bytes for the length, then read that many bytes for the JSON payload.
