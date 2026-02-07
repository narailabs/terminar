# termiNar

A VS Code extension backed by a Rust server that provides persistent terminal sessions. Sessions survive VS Code crashes, restarts, and disconnections. Includes a web-based terminal frontend and remote pairing support.

## Architecture

```
+-------------------+       Unix Socket       +---------------------+
|                   | (length-prefixed JSON)   |                     |
|   VS Code         |<------------------------>|   Rust Server       |
|   Extension       |                          |   (persistent-      |
|                   |                          |    shell-server)    |
+-------------------+                          |                     |
                                               |   +-------------+  |
+-------------------+       WebSocket          |   | PTY Sessions |  |
|                   |   (JSON over WS)         |   +--+--+--+----+  |
|   Web Frontend    |<------------------------>|      |  |  |       |
|   (browser)       |                          |   bash zsh fish    |
|                   |       HTTP REST          |                     |
|                   |<------------------------>|   /health           |
+-------------------+                          |   /metrics          |
                                               |   /pair/exchange    |
                                               |   /auth/revoke      |
                                               +---------------------+
```

**Communication paths:**

- **VS Code Extension <-> Server**: Unix Domain Socket at `/tmp/vscode-terminar-<uid>.sock` using 4-byte big-endian length-prefixed JSON framing.
- **Web Frontend <-> Server**: WebSocket on the HTTP port (default 3000) for real-time I/O, plus REST endpoints for health, metrics, pairing, and token management.
- **PTY Sessions**: The server spawns and manages pseudo-terminal processes (bash, zsh, fish) that persist independently of any client.

## Quick Start

### Prerequisites

- **Rust** (1.70+) with `cargo`
- **Node.js** (16+) with `pnpm`
- **VS Code** (1.75+)

### 1. Install dependencies

From the monorepo root:

```bash
pnpm install
```

### 2. Build the Rust server

```bash
cd server
cargo build
```

For a release build:

```bash
cargo build --release
```

### 3. Build the VS Code extension

```bash
cd extension
pnpm run compile
```

### 4. Run in development

1. Open the repo root in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. In the new window, use the command palette (`Cmd+Shift+P`) and run:
   - `termiNar: New Persistent Session`
4. Or click the **termiNars** icon in the Activity Bar.

### 5. Run the server standalone

```bash
cd server
cargo run -- --port 3000
```

### 6. Run tests

```bash
cd server
cargo test
```

## Server CLI Reference

```
terminar-server [OPTIONS] [COMMAND]
```

### Subcommands

| Command | Description |
|---------|-------------|
| `pair`  | Generate a pairing code for remote client authentication |

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-p, --port <PORT>` | `3000` | HTTP/WebSocket listen port |
| `-s, --socket <PATH>` | `/tmp/vscode-terminar-<uid>.sock` | Unix Domain Socket path |
| `-l, --log-level <LEVEL>` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error` |
| `--log-json` | `false` | Output logs in structured JSON format |
| `--log-file <PATH>` | (none) | Write logs to a file in addition to console |
| `--no-auth` | `false` | Disable authentication (development only) |
| `--mock-pty` | `false` | Use mock PTY backend for testing |
| `--cors-origin <ORIGIN>` | localhost defaults | Allowed CORS origins (repeatable) |
| `--persist-sessions` | `false` | Persist session metadata to disk for recovery |
| `--session-file <PATH>` | `/tmp/terminar-sessions.json` | Path to session persistence file |
| `--persist-history` | `false` | Persist terminal history to disk |
| `--history-dir <PATH>` | `/tmp/terminar-history` | Directory for history persistence files |
| `--compress-history` | `false` | Enable zstd compression for history buffers exceeding 1MB |

### Examples

```bash
# Start with custom port and JSON logging
terminar-server --port 8080 --log-json

# Start with session persistence and log file
terminar-server --persist-sessions --log-file /var/log/pshell.log

# Start with custom CORS origins
terminar-server --cors-origin http://myapp.com --cors-origin http://localhost:5173

# Generate a pairing code for remote access
terminar-server pair
```

## VS Code Extension Settings

Configure these in VS Code settings (`Cmd+,`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `terminar.serverPath` | `string` | `""` | Custom path to the `terminar-server` binary. Leave empty to use the bundled server. |
| `terminar.socketPath` | `string` | `""` | Custom Unix socket path for server communication. Leave empty for the default. |
| `terminar.authToken` | `string` | `""` | Stored authentication token. Normally auto-read from `~/.terminar/token`. |
| `terminar.autoStart` | `boolean` | `true` | Automatically start the server when the extension activates. |

### Extension Commands

| Command | Description |
|---------|-------------|
| `termiNar: New Persistent Session` | Create a new terminal session |
| `termiNar: Attach to Session` | Attach to an existing session |
| `termiNar: Connect to Remote Server` | Connect to a remote server via pairing |
| `termiNar: Stop Server` | Stop the background server |
| `termiNar: Rename Session` | Rename an existing session |
| `termiNar: Kill Session` | Terminate a session |

## Remote Pairing

To connect to a server running on a remote machine:

1. On the host, run:
   ```bash
   terminar-server pair
   ```
2. Note the 8-digit pairing code (valid for 5 minutes).
3. In VS Code on the client, run `termiNar: Connect to Remote Server`.
4. Enter the host address and pairing code.

## Bazel Workflow (CI/Build)

```bash
# Build everything
bazel build //...

# Run Rust tests via Bazel
bazel test //server:test
```

## Docker

Build and run the server in a container:

```bash
# Build
docker build -t terminar-server -f Dockerfile 

# Run
docker run -p 3000:3000 terminar-server
```

See the [Dockerfile](./Dockerfile) for details.

## Troubleshooting

### Socket errors

If the server crashes or is killed without cleanup, a stale socket file may remain:

```bash
rm /tmp/vscode-terminar-*.sock
```

### Binary not found

If the extension cannot find the server binary, ensure you have run `cargo build` in the `server/` directory. Alternatively, set `terminar.serverPath` in VS Code settings to point to the binary.

### Authentication issues

The server writes a token to `~/.terminar/token` on startup. The extension reads this file automatically. If authentication fails:

1. Check that the token file exists: `cat ~/.terminar/token`
2. Ensure the file permissions are correct (owner-only: `0600`)
3. Restart the server to generate a new token

### Port already in use

If port 3000 is occupied, start the server on a different port:

```bash
terminar-server --port 8080
```

### WebSocket connection rejected

The server validates WebSocket origins against a whitelist. By default, only localhost origins on common development ports (3000, 3001, 5173, 8080) are allowed. Add custom origins with:

```bash
terminar-server --cors-origin http://your-app.example.com
```

### Session not responding

If a session becomes unresponsive, kill it from the VS Code sidebar or via the `Kill Session` command. The server monitors WebSocket connections with ping/pong health checks (30-second intervals, 60-second timeout).

## API Documentation

See [docs/API.md](./docs/API.md) for the full protocol reference, REST endpoints, and WebSocket authentication flow.
