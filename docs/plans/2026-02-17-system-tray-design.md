# System Tray App Design

## Goal

A cross-platform system tray application that installs and controls the terminar gateway as a system service, providing a GUI for security settings and session monitoring.

## Architecture

**Tauri 2 app** (`tray/`) with a Rust backend and a small Svelte frontend (settings window only). The tray app does not run the server itself — it always manages a system-level `terminar-gateway` service via the OS service manager (launchd on macOS, systemd on Linux, Windows Service on Windows).

### How It Works

```
┌─────────────────────────────┐
│     Tray App (Tauri 2)      │
│  ┌────────┐  ┌───────────┐  │
│  │  Rust  │  │  Svelte   │  │     launchctl / systemctl / sc.exe
│  │backend │  │ settings  │  │──────────────────────────────────────►  terminar-gateway (system service)
│  │        │  │  window   │  │                                              │
│  └────────┘  └───────────┘  │     GET /health (every 5s)                   │
│       │                     │◄─────────────────────────────────────         │
│       │  tray menu          │                                              ▼
│       ▼                     │                                     per-user terminar-server
│  [● Running] [sessions]     │                                     instances (on demand)
└─────────────────────────────┘
```

### Key Decisions

1. **Always a system service** — no child-process mode. On first launch, if the service isn't installed, the tray app prompts to install it.
2. **Tauri 2** — small binary (~5 MB), native tray via `tray-icon` plugin, Svelte settings window via OS webview. Cross-platform: macOS, Windows, Linux.
3. **Config at `~/.terminar/tray-config.json`** — user-level config for the tray app's preferences and the gateway's launch arguments.
4. **Existing deploy files** — the service definitions in `deploy/` (`com.terminar.gateway.plist`, `terminar-gateway.service`, `terminar-sudoers`) are used as templates during installation.

---

## First-Launch Flow

1. Tray app starts, checks if the gateway service is registered with the OS.
2. If **not installed**:
   - Show a small "Install" window explaining what will happen.
   - User clicks "Install" → tray app requests admin privileges.
   - Copies `terminar-gateway` and `terminar-server` binaries to `/usr/local/bin/` (macOS/Linux) or `C:\Program Files\terminar\` (Windows).
   - Writes the service definition from `deploy/` templates, substituting config values (port, TLS mode, audit level).
   - On Linux: creates `terminar` system user, installs sudoers fragment.
   - On macOS: creates `terminar` system user via `sysadminctl`.
   - Starts the service.
3. If **already installed**: polls `/health` and shows the tray menu normally.

### Privilege Elevation

- **macOS**: `osascript -e 'do shell script "..." with administrator privileges'`
- **Linux**: `pkexec` (PolicyKit)
- **Windows**: Tauri's `shell` plugin with `runas` verb, triggers UAC prompt

---

## Tray Menu Structure

```
 Gateway: ● Running (port 4000, TLS)
─────────────────────────────────────
 ● zsh - session 1
 ○ python3 - session 2
─────────────────────────────────────
 New Session
 Open Web UI
─────────────────────────────────────
 ▸ Security
    ✓ Auto-TLS
    ✓ Auth Required
      Audit Level ▸ [off | auth | standard | verbose]
─────────────────────────────────────
 Restart Service
 Stop Service
 Settings...
─────────────────────────────────────
 Quit
```

### Menu Behaviors

| Item | Action |
|------|--------|
| Gateway status | Display only (green/yellow/red dot) |
| Session items | Click opens web UI filtered to that session |
| New Session | Opens web UI (which creates session on connect) |
| Open Web UI | Opens `https://localhost:<tls_port>/` in default browser |
| Security toggles | Updates config, prompts "Restart service to apply?" |
| Restart/Stop Service | Runs `launchctl`/`systemctl`/`sc` commands (may need elevation) |
| Settings | Opens the Svelte settings window |
| Quit | Closes the tray app only (service keeps running) |

**Quit does NOT stop the service.** The gateway continues running as a system daemon. The tray app is just a control panel.

---

## Config File

Stored at `~/.terminar/tray-config.json`:

```json
{
  "gateway_port": 4000,
  "tls_mode": "auto",
  "tls_cert": null,
  "tls_key": null,
  "tls_port": 8444,
  "require_auth": true,
  "audit_level": "standard",
  "idle_timeout": 1800
}
```

When security settings change, the tray app:
1. Writes the updated config.
2. Regenerates the service definition from the template with new values.
3. Prompts "Restart service to apply changes?"
4. If yes, stops and restarts the service (with elevation if needed).

---

## Settings Window

A small Svelte webview (~400x500px) with sections:

### Network
- **Gateway Port** — number input (default: 4000)
- **TLS Port** — number input (default: 8444)

### Security
- **TLS Mode** — dropdown: Off / Auto (self-signed) / Custom certificate
- **Certificate Path** — file picker (visible when TLS = Custom)
- **Key Path** — file picker (visible when TLS = Custom)
- **Require Auth** — toggle (default: on)
- **Audit Level** — dropdown: Off / Auth / Standard / Verbose

### Service
- **Idle Timeout** — number input in minutes (default: 30)
- **Uninstall Service** — button with confirmation dialog

### Actions
- **Save** — writes config, offers restart
- **Cancel** — discards changes

---

## Health Polling

The tray app polls `GET http://localhost:<gateway_port>/health` every 5 seconds.

Response (from existing `/health` endpoint):
```json
{
  "status": "ok",
  "sessions": 3,
  "version": "0.1.0"
}
```

The tray menu updates dynamically:
- **Green dot** — health returns 200
- **Yellow dot** — service process exists but health fails (starting up)
- **Red dot** — service not running or health fails repeatedly

For the session list, the tray app connects to the gateway via WebSocket and sends a `list_sessions` message (existing protocol), or a new lightweight `GET /sessions` HTTP endpoint could be added to avoid maintaining a WebSocket connection just for the tray.

---

## Service Management Commands

### macOS (launchd)

| Action | Command |
|--------|---------|
| Install | `sudo cp com.terminar.gateway.plist /Library/LaunchDaemons/` |
| Start | `sudo launchctl bootstrap system /Library/LaunchDaemons/com.terminar.gateway.plist` |
| Stop | `sudo launchctl bootout system/com.terminar.gateway` |
| Status | `sudo launchctl print system/com.terminar.gateway` |
| Uninstall | Stop + `sudo rm /Library/LaunchDaemons/com.terminar.gateway.plist` |

### Linux (systemd)

| Action | Command |
|--------|---------|
| Install | `sudo cp terminar-gateway.service /etc/systemd/system/` + `sudo systemctl daemon-reload` |
| Start | `sudo systemctl start terminar-gateway` |
| Stop | `sudo systemctl stop terminar-gateway` |
| Status | `systemctl is-active terminar-gateway` |
| Enable | `sudo systemctl enable terminar-gateway` |
| Uninstall | Disable + stop + remove unit file |

### Windows (sc.exe)

| Action | Command |
|--------|---------|
| Install | `sc.exe create terminar-gateway binPath= "..." start= auto` |
| Start | `sc.exe start terminar-gateway` |
| Stop | `sc.exe stop terminar-gateway` |
| Status | `sc.exe query terminar-gateway` |
| Uninstall | Stop + `sc.exe delete terminar-gateway` |

---

## Binary Discovery

The tray app finds the gateway and server binaries in this order:

1. **Bundled** — same directory as the tray binary (production/packaged)
2. **Workspace dev** — `../server/target/release/terminar-gateway` or `../server/target/debug/terminar-gateway`
3. **System path** — `which terminar-gateway`

The install step copies binaries to `/usr/local/bin/` (macOS/Linux) or `C:\Program Files\terminar\` (Windows).

---

## Project Structure

```
tray/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs        # Tauri app: tray icon, menu builder, event loop
│   │   ├── service.rs     # Install/uninstall/start/stop/restart/status
│   │   │                  # (launchctl, systemctl, sc.exe abstraction)
│   │   ├── health.rs      # Poll /health, parse response, emit status updates
│   │   └── config.rs      # Read/write ~/.terminar/tray-config.json
│   ├── Cargo.toml         # tauri, serde, serde_json, reqwest, tokio
│   ├── tauri.conf.json    # No default window, tray-icon plugin enabled
│   ├── capabilities/      # Tauri permissions (shell, fs, tray)
│   └── icons/             # App icons (png + ico)
├── src/
│   ├── main.ts            # Svelte mount point
│   ├── Settings.svelte    # Settings window
│   └── Install.svelte     # First-run install prompt
├── package.json           # svelte, @tauri-apps/api, vite
└── vite.config.ts
```

### Dependencies

**Rust (src-tauri/Cargo.toml)**:
- `tauri` with `tray-icon` feature
- `serde` + `serde_json` — config serialization
- `reqwest` — HTTP health polling
- `tokio` — async runtime (already used by Tauri)

**Frontend (package.json)**:
- `svelte` — settings UI
- `@tauri-apps/api` — invoke Rust commands from Svelte
- `@tauri-apps/plugin-shell` — privilege elevation
- `@tauri-apps/plugin-dialog` — file picker for TLS certs
- `vite` + `@sveltejs/vite-plugin-svelte`

---

## What's NOT in Scope

- The tray app does not embed or replace the web frontend — it opens it in the browser.
- No terminal emulation in the tray app itself.
- No gateway code changes needed (existing `/health` endpoint suffices).
- No SSH/shell integration — this is purely a service control panel.
- The existing VS Code extension continues to work independently (it connects directly to the server, not through the tray app).
