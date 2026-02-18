# Coding Agent Detection & Terminal Icons

## Overview

Detect when a coding agent (Claude Code, Gemini CLI, Codex CLI, etc.) is running in a terminal session and change the tab icon + show a status badge with the agent name.

---

## Architecture: Hybrid

```
Server                              Client (Web / VS Code / Electron)
┌─────────────────────┐            ┌──────────────────────────────┐
│ PTY Session          │            │                              │
│   │                  │            │  Agent registry (built-in    │
│   ├─ tcgetpgrp(fd)   │   poll    │  + user overrides)           │
│   │  → foreground    │ ──────►   │    │                         │
│   │    process name  │ SessionInfo│    ├─ Match process name     │
│   │                  │ includes   │    │  → agent type           │
│   └─ report in       │ fg_process│    ├─ Select icon + color    │
│      SessionInfo     │            │    └─ Render tab icon +      │
└─────────────────────┘            │       status badge           │
                                   └──────────────────────────────┘
```

**Server responsibility:** Detect the foreground process name via `tcgetpgrp()` and report it in `SessionInfo`.

**Client responsibility:** Map process names to agent types using a registry (built-in defaults + user overrides). Render the appropriate icon and badge.

---

## Detection Method: Foreground Process Name

### How it works

1. Server stores the PTY file descriptor and shell child PID per session
2. Every 2 seconds (configurable), server calls `tcgetpgrp(pty_fd)` to get the foreground process group ID (PGID)
3. Server looks up the process name for that PGID:
   - **Linux:** Read `/proc/<pid>/comm` for processes matching the PGID
   - **macOS:** Use `sysctl(KERN_PROC, KERN_PROC_PGRP, pgid)` to find processes, then get command name
4. Server updates `SessionInfo.foreground_process` with the process name
5. Clients receive this on every `list_sessions` response or via a new `session_updated` push notification

### Rust implementation sketch

```rust
use nix::unistd::tcgetpgrp;
use std::os::fd::RawFd;

/// Get the foreground process name for a PTY session
fn get_foreground_process(pty_fd: RawFd) -> Option<String> {
    let pgid = tcgetpgrp(pty_fd).ok()?;

    #[cfg(target_os = "linux")]
    {
        // Read /proc/<pid>/comm for the process group leader
        let comm = std::fs::read_to_string(format!("/proc/{}/comm", pgid.as_raw())).ok()?;
        Some(comm.trim().to_string())
    }

    #[cfg(target_os = "macos")]
    {
        // Use sysctl to get process info for the PGID
        // ... platform-specific implementation
    }
}
```

### Polling strategy

- **Active sessions** (client attached): Poll every 2 seconds
- **Idle sessions** (no client): Poll every 10 seconds or skip
- **Optimization:** Only poll when the session has had recent output (avoids wasting cycles on idle terminals)

---

## Protocol Changes

### SessionInfo extension

```rust
pub struct SessionInfo {
    pub id: String,
    pub name: String,
    pub shell: String,
    pub cwd: String,
    pub started_at: String,
    // NEW:
    pub foreground_process: Option<String>,  // e.g., "claude", "node", "vim"
}
```

### New push notification (optional, for real-time updates)

```rust
ServerMessage::ForegroundChanged {
    session_id: String,
    process_name: Option<String>,
}
```

This avoids clients needing to poll `list_sessions` repeatedly just to check for agent changes.

---

## Client-Side Agent Registry

### Built-in defaults

```typescript
interface AgentDefinition {
  /** Process names that identify this agent */
  processNames: string[];
  /** Display name shown in status badge */
  displayName: string;
  /** Icon identifier (maps to bundled SVG/PNG) */
  icon: string;
  /** Accent color for tab/border */
  color: string;
}

const BUILT_IN_AGENTS: Record<string, AgentDefinition> = {
  "claude-code": {
    processNames: ["claude"],
    displayName: "Claude Code",
    icon: "claude",
    color: "#D97706",  // amber/orange
  },
  "gemini-cli": {
    processNames: ["gemini"],
    displayName: "Gemini CLI",
    icon: "gemini",
    color: "#4285F4",  // Google blue
  },
  "codex-cli": {
    processNames: ["codex"],
    displayName: "Codex CLI",
    icon: "codex",
    color: "#10A37F",  // OpenAI green
  },
  "cursor-agent": {
    processNames: ["cursor-agent"],
    displayName: "Cursor",
    icon: "cursor",
    color: "#7C3AED",  // purple
  },
  "aider": {
    processNames: ["aider"],
    displayName: "Aider",
    icon: "aider",
    color: "#14B8A6",  // teal
  },
  "amazon-q": {
    processNames: ["q", "qterm"],
    displayName: "Amazon Q",
    icon: "amazon-q",
    color: "#FF9900",  // AWS orange
  },
  "github-copilot": {
    processNames: ["copilot"],
    displayName: "Copilot CLI",
    icon: "copilot",
    color: "#6E40C9",  // GitHub purple
  },
};
```

### User overrides (in client settings)

Users can add custom entries or override built-in ones:

```json
{
  "terminar.agentDetection": {
    "my-custom-agent": {
      "processNames": ["my-agent"],
      "displayName": "My Agent",
      "icon": "custom",
      "color": "#FF0000"
    },
    "claude-code": {
      "color": "#FF5733"
    }
  }
}
```

**Merge behavior:** User settings are deep-merged with built-in defaults. User entries override built-in entries of the same key. New keys add new agents.

---

## UI Design

### Tab icon + status badge

```
┌─────────────────────────────────────────────────┐
│ [Claude Icon] terminar: /bin/zsh  │  [x]        │  ← tab with agent icon
├─────────────────────────────────────────────────┤
│                                                  │
│  $ claude                                        │
│  > Working on feature...                         │
│                                                  │
│                                                  │
├──────────────────────────────────────────────────┤
│ Claude Code │ /Users/narayan/src/narai │ 0:23:15  │  ← status badge in pane header
└──────────────────────────────────────────────────┘
```

**Tab changes:**
- Default terminal icon → agent logo when an agent is detected
- Tab text remains the session name
- Icon reverts to default terminal when agent process exits

**Pane header / status badge:**
- Show agent name with icon in the pane header or a small badge area
- Include the accent color as a subtle left-border or badge background
- When no agent is detected, show the foreground process name if non-shell (e.g., "vim", "node", "cargo")

### Sidebar changes

- Session list items also show the agent icon when detected
- Tooltip shows: "Running: Claude Code" or "Running: /bin/zsh"

---

## Known Agent Process Signatures

| Agent | Process Name | Runtime | Notes |
|-------|-------------|---------|-------|
| Claude Code | `claude` | Native binary | Also sets `CLAUDECODE=1` env var |
| Gemini CLI | `gemini` | Node.js | May show as `node` with args |
| Codex CLI | `codex` | Node.js | May show as `node` with args |
| Cursor | `cursor-agent` | Node.js | |
| Aider | `aider` | Python | May show as `python` with args |
| Amazon Q | `q`, `qterm` | Native binary | Being rebranded to "Kiro" |
| GitHub Copilot | `copilot` | Node.js | `gh copilot` shows as `gh` |

### Node.js-based agent challenge

Several agents (Gemini, Codex, Copilot) run as Node.js processes, so `comm` may report `node` instead of the agent name. Solutions:

1. **Check `/proc/<pid>/cmdline`** (Linux) or equivalent — this shows the full command including arguments like `node /path/to/gemini`
2. **Walk up from the foreground process** — the `node` process is typically a child of a wrapper script that has the recognizable name
3. **Check the symlink target** — on many systems, `gemini` is a symlink to a Node.js wrapper that execs with `node`

The server should try `comm` first, and if it's `node` or `python`, fall back to reading the full command line or checking parent processes.

---

## Implementation Plan

### Server changes (Rust)

1. Add `foreground_process: Option<String>` to `SessionInfo`
2. Store PTY file descriptor (raw fd) in `Session` struct
3. Add a background task that polls `tcgetpgrp()` for all active sessions every 2s
4. Platform-specific process name resolution:
   - Linux: `/proc/<pgid>/comm`, fallback to `/proc/<pgid>/cmdline`
   - macOS: `sysctl(KERN_PROC, KERN_PROC_PGRP)` + `proc_name()`
5. Add `ForegroundChanged` push notification to avoid client polling
6. Crates needed: `nix` (already a dependency for PTY ops)

### Protocol changes (shell-protocol)

1. Add `foreground_process?: string` to `SessionInfo` Zod schema
2. Add `ForegroundChanged` server message type
3. Bump protocol version

### Web UI changes (Svelte)

1. Add agent registry with built-in defaults
2. Agent matching logic: `foreground_process` → lookup in registry → icon + color + displayName
3. Bundle agent icon SVGs (or use a simple emoji/letter fallback)
4. Update `TabBar` component to show agent icon
5. Update `Pane` header to show status badge with agent name
6. Update `Sidebar` session list to show agent icon
7. Add `terminar.agentDetection` to settings for user overrides

### VS Code extension changes

1. Read `foreground_process` from `SessionInfo`
2. Map to agent definitions (shared registry)
3. Update `SessionTreeProvider` to show icons in the sidebar tree

---

## Edge Cases

- **Agent exits:** `foreground_process` returns to shell name (e.g., `zsh`). Client removes agent icon.
- **Nested agents:** User runs `claude` which spawns `aider`. Foreground detection shows the innermost foreground process.
- **Multiple agents in split panes:** Each pane has its own session, so each independently detects its agent.
- **Unknown process:** If `foreground_process` doesn't match any agent, show it as plain text in the status badge (e.g., "vim", "cargo build"). No special icon.
- **Permission denied:** On some systems, reading process info may fail. Gracefully return `None` — no icon shown.
