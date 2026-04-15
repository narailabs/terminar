//! Session lifecycle message handlers: CreateSession, KillSession, RenameSession, ListSessions.

use crate::AppState;
use crate::messages::{ServerMessage, SessionInfo};
use crate::persistence;
use crate::session::SessionMap;

use portable_pty::CommandBuilder;
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{info, instrument};

// Re-export core engine functions used by other handler modules
pub use terminar_core::engine::{clamp_dimension, filter_env};

/// Default shell for remote sessions (Docker/SSH) when client sends empty shell.
/// `/bin/sh` is the most universally available shell on remote systems.
const REMOTE_DEFAULT_SHELL: &str = "/bin/sh";

/// PROMPT_COMMAND value that emits an OSC 7 cwd report on every prompt.
///
/// Bash re-parses this string as a shell command before drawing each prompt,
/// expanding `${HOSTNAME:-$(hostname)}` and `$PWD` at that time and invoking
/// `printf` to write the OSC 7 escape sequence (`ESC ]7;file://HOST/PATH BEL`).
///
/// The server's OSC 7 sniffer (`cwd_watcher.rs`) picks up the escape sequence
/// from the session's broadcast channel and updates `session.cwd` accordingly.
const OSC7_PROMPT_COMMAND: &str =
    r#"printf "\033]7;file://%s%s\007" "${HOSTNAME:-$(hostname)}" "$PWD""#;

/// Shell-function definitions injected into remote sessions so programs that
/// shell out to native clipboard / URL-open tools (Claude Code is the driving
/// example) have their actions transparently redirected back to the user's
/// local system via OSC sequences.
///
/// The functions emit:
/// - **OSC 52** (`ESC ]52;c;<base64-data> BEL`) for clipboard writes. This is
///   the de-facto standard clipboard escape sequence; terminar parses it on
///   the server side and routes the payload to the local clipboard.
/// - **OSC 7777** (`ESC ]7777;open_url;<base64-url> BEL`) for URL opens. This
///   is terminar's custom vocabulary (no standard exists); the server parses
///   it and routes the URL to the local default browser.
///
/// The shim is a static constant — no user input is interpolated, so there
/// is no shell injection surface. Continues to rely on `shell_quote()` for
/// any user-controlled strings (`cwd`, `shell`) interpolated elsewhere in
/// the remote command.
const SHIM_FUNCTIONS: &str = r#"pbcopy() { printf '\033]52;c;%s\007' "$(base64 | tr -d '\n')"; }
xclip() { pbcopy; }
xsel() { pbcopy; }
wl-copy() { pbcopy; }
_terminar_open_url() { printf '\033]7777;open_url;%s\007' "$(printf %s "$1" | base64 | tr -d '\n')"; }
open() { _terminar_open_url "$1"; }
xdg-open() { _terminar_open_url "$1"; }
export BROWSER=_terminar_open_url"#;

/// Return the final path component of a shell path (e.g. `/bin/bash` → `bash`).
fn shell_basename(shell: &str) -> &str {
    std::path::Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
}

/// Whether we should inject `PROMPT_COMMAND` as an environment variable for
/// this target shell. Only bash (and `sh` which on RHEL-family systems is
/// bash in POSIX mode) honors PROMPT_COMMAND; dash/ash ignore it silently so
/// the injection is harmless on those. Zsh and fish have their own prompt
/// hook mechanisms that cannot be set via env var — used by the Docker
/// session path (SSH uses `build_ssh_remote_command` which handles zsh via
/// ZDOTDIR and all other shells via a match).
fn shell_supports_prompt_command(shell: &str) -> bool {
    matches!(shell_basename(shell), "bash" | "sh")
}

/// Build the inline remote command passed to `ssh user@host <cmd>`.
///
/// The command:
/// 1. Optionally `cd`s to the requested starting directory.
/// 2. Injects [`SHIM_FUNCTIONS`] so `pbcopy`/`xclip`/`xsel`/`wl-copy`/`open`/
///    `xdg-open` are transparently redirected to terminar's OSC sequences
///    (which the server parses and routes back to the local client).
/// 3. Preserves OSC 7 cwd tracking via the shell's native prompt hook
///    mechanism (bash `PROMPT_COMMAND` or zsh `precmd`).
/// 4. `exec`s the target shell so the remote-side login shell is replaced
///    by the actual interactive shell (no intermediate wrapper process).
///
/// Shell-specific handling:
/// - **bash / sh**: define shim functions in the login shell, `export -f`
///   them so bash re-imports them via env on the subsequent `exec bash`,
///   then set `PROMPT_COMMAND` and exec.
/// - **zsh**: `export -f` is bash-specific and functions do not survive
///   `exec zsh`. Instead, write a temporary `.zshrc` containing the shim
///   (plus a source of the user's real `.zshrc`), set `ZDOTDIR` to its
///   directory, and exec zsh. Cwd tracking is added via `add-zsh-hook
///   precmd`.
/// - **other shells** (fish, etc.): fall back to a plain `exec`, no shim.
///   Clipboard + URL auto-redirect is not available; users can still rely
///   on tools that emit OSC 52 natively.
///
/// Both `cwd` and `shell` are single-quoted via `shell_quote()` for shell
/// safety; this is a second line of defense on top of `validate_remote_shell()`.
fn build_ssh_remote_command(cwd: &str, shell: &str) -> String {
    let cd_part = if !cwd.is_empty() && cwd != "/" {
        format!("cd {} && ", shell_quote(cwd))
    } else {
        String::new()
    };

    let shell_arg = shell_quote(shell);

    match shell_basename(shell) {
        "bash" | "sh" => {
            // Define shim functions, export them to env so bash re-imports
            // them on `exec`, then set PROMPT_COMMAND (for OSC 7 cwd) and
            // exec the target shell.
            format!(
                "{cd}{shim}\nexport -f pbcopy xclip xsel wl-copy _terminar_open_url open xdg-open 2>/dev/null || true\nPROMPT_COMMAND={pc} exec {sh}",
                cd = cd_part,
                shim = SHIM_FUNCTIONS,
                pc = shell_quote(OSC7_PROMPT_COMMAND),
                sh = shell_arg,
            )
        }
        "zsh" => {
            // Write a temp .zshrc with shim (and OSC 7 cwd hook), set
            // ZDOTDIR, and exec zsh. Sourcing the user's real .zshrc first
            // preserves their config; our shim defined after it wins.
            format!(
                "{cd}TERMINAR_ZDOTDIR=$(mktemp -d /tmp/terminar-zdot.XXXXXX) && cat > \"$TERMINAR_ZDOTDIR/.zshrc\" <<'TERMINAR_SHIM_EOF'\n[ -f \"$HOME/.zshrc\" ] && source \"$HOME/.zshrc\"\n{shim}\n_terminar_cwd() {{ printf '\\033]7;file://%s%s\\007' \"$(hostname)\" \"$PWD\"; }}\nautoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook precmd _terminar_cwd\nTERMINAR_SHIM_EOF\nZDOTDIR=\"$TERMINAR_ZDOTDIR\" exec {sh}",
                cd = cd_part,
                shim = SHIM_FUNCTIONS,
                sh = shell_arg,
            )
        }
        _ => {
            // Unknown shell — fall back to plain exec, no shim.
            format!("{cd}exec {sh}", cd = cd_part, sh = shell_arg)
        }
    }
}

/// Validate a shell path intended for remote execution (Docker container, SSH host).
///
/// Unlike the local SHELL_WHITELIST, remote shells vary widely (`/bin/ash` on Alpine,
/// `/bin/busybox`, etc.), so we can't use a whitelist. Instead we enforce a strict
/// format that blocks shell metacharacter injection.
///
/// Returns `Err` with a user-facing message if validation fails.
pub fn validate_remote_shell(shell: &str) -> Result<(), String> {
    if shell.is_empty() {
        return Err("Remote shell path is empty".to_string());
    }
    if shell.len() > 256 {
        return Err(format!("Remote shell path too long ({} chars, max 256)", shell.len()));
    }
    if !shell.starts_with('/') {
        return Err(format!("Remote shell '{}' must be an absolute path", shell));
    }
    // Block shell metacharacters, whitespace, quotes, and backslashes.
    // Anything that could change how the shell parses the command.
    const FORBIDDEN: &[char] = &[
        ';', '&', '|', '`', '$', '(', ')', '<', '>',
        '\n', '\r', '\t', ' ', '\0', '\\', '"', '\'',
    ];
    if let Some(bad) = shell.chars().find(|c| FORBIDDEN.contains(c)) {
        return Err(format!(
            "Remote shell '{}' contains forbidden character: {:?}",
            shell, bad
        ));
    }
    Ok(())
}

/// Build a SessionInfo list from the current sessions.
fn build_session_list(sessions: &SessionMap) -> Vec<SessionInfo> {
    terminar_core::engine::build_session_list(sessions)
}

/// Handle ListSessions message.
#[instrument(skip(tx_out, sessions))]
pub(crate) async fn handle_list_sessions(
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    let list = enrich_session_list(build_session_list(sessions));
    tx_out
        .send(ServerMessage::SessionList { sessions: list })
        .await?;
    Ok(())
}

/// Handle CreateSession message.
#[allow(clippy::too_many_arguments)]
#[instrument(skip(env, tx_out, sessions, state), fields(shell = %shell, cwd = %cwd, cols = cols, rows = rows))]
pub(crate) async fn handle_create_session(
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    container_id: Option<&str>,
    ssh_connection_id: Option<&str>,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    // Clamp dimensions to valid range (1-500)
    let cols = terminar_core::engine::clamp_dimension(cols, "cols");
    let rows = terminar_core::engine::clamp_dimension(rows, "rows");

    let counter = state
        .session_name_counter
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    // Routing: container_id present → Docker session (local or remote,
    // depending on whether ssh_connection_id is also set). ssh_connection_id
    // alone → SSH shell session. Neither → local shell session.
    let result = match (container_id, ssh_connection_id) {
        (Some(cid), ssh) => {
            create_docker_session(cid, ssh, cwd, shell, env, cols, rows, counter, sessions, state)
                .await
        }
        (None, Some(sid)) => {
            create_ssh_session(sid, cwd, shell, cols, rows, counter, sessions, state)
        }
        (None, None) => create_local_session(cwd, shell, env, cols, rows, counter, sessions, state),
    };

    match result {
        Ok(id) => {
            state
                .sessions_total
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            // For SSH and Docker sessions, spawn an OSC watcher. Local
            // polling in poll_foreground_processes() is skipped for these
            // session types because tcgetpgrp/proc point at the ssh/docker
            // wrapper process, not the remote shell. Instead we parse OSC
            // escape sequences emitted by the remote shell to (a) keep cwd
            // fresh (OSC 7) and (b) route clipboard writes (OSC 52) and
            // URL opens (OSC 7777) back to the local client.
            if container_id.is_some() || ssh_connection_id.is_some() {
                crate::cwd_watcher::spawn_cwd_watcher(
                    id,
                    sessions.clone(),
                    state.tool_action_tx.clone(),
                );
            }

            let list = enrich_session_list(build_session_list(sessions));
            tx_out
                .send(ServerMessage::SessionList { sessions: list })
                .await?;
        }
        Err(msg) => {
            // Roll back the name counter on failure to avoid "Terminal 3, 5, 6" gaps.
            // Not race-free under concurrent failures, but acceptable for cosmetic counter.
            state
                .session_name_counter
                .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("SESSION_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

/// Enrich SessionInfo list with SSH connection details (host/user) for display.
/// Looks up each session's ssh_connection_id and populates ssh_host/ssh_user.
fn enrich_session_list(mut list: Vec<SessionInfo>) -> Vec<SessionInfo> {
    for info in list.iter_mut() {
        if let Some(ref sid) = info.ssh_connection_id {
            if let Some(conn) = super::ssh::get_connection(sid) {
                info.ssh_host = Some(conn.host);
                info.ssh_user = Some(conn.user);
            }
        }
    }
    list
}

/// Expand a leading `~/` in a path using the session env's `HOME`, falling
/// back to the server process's `HOME`. Returns the original string if it
/// doesn't start with `~/`. A bare `~` (without a slash) is also expanded
/// to `$HOME`. Empty strings pass through unchanged.
fn expand_tilde(cwd: &str, env: &HashMap<String, String>) -> String {
    if cwd == "~" {
        return home_dir(env);
    }
    if let Some(rest) = cwd.strip_prefix("~/") {
        let home = home_dir(env);
        if home.is_empty() {
            // Can't expand without HOME; return original so resolve_cwd can
            // produce an error a caller can react to.
            return cwd.to_string();
        }
        return format!("{}/{}", home.trim_end_matches('/'), rest);
    }
    cwd.to_string()
}

fn home_dir(env: &HashMap<String, String>) -> String {
    env.get("HOME")
        .cloned()
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default()
}

/// Create a local shell session (existing behavior).
#[allow(clippy::too_many_arguments)]
fn create_local_session(
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    let resolved_shell = terminar_core::engine::resolve_shell(shell);

    // Expand a leading `~/` so users can configure a default folder like
    // `~/code` in settings. `terminar_core::engine::resolve_cwd` doesn't do
    // this (and lives in an external crate), so handle it here.
    let expanded_cwd = expand_tilde(cwd, env);

    let resolved_cwd = terminar_core::engine::resolve_cwd(&expanded_cwd);

    if let Some(error_msg) = terminar_core::engine::validate_shell(&resolved_shell) {
        return Err(error_msg);
    }
    if let Some(error_msg) = terminar_core::engine::validate_cwd(&resolved_cwd) {
        return Err(error_msg);
    }

    let name = format!("Terminal {}", counter);

    let session_env = if resolved_shell.ends_with("/zsh") || resolved_shell.ends_with("/zsh5") {
        crate::shell_init::prepare_zsh_env(env)
    } else {
        env.clone()
    };

    terminar_core::engine::create_session(
        None,
        &name,
        &resolved_shell,
        &resolved_cwd,
        cols,
        rows,
        &session_env,
        sessions,
        state.mock_provider.as_ref(),
        None,
    )
    .map_err(|e| format!("Failed to create session: {}", e))
}

/// Create a Docker container session via `docker exec`. When
/// `ssh_connection_id` is `Some`, targets the Docker daemon on the remote host
/// by setting `DOCKER_HOST=ssh://user@host:port` on the spawned `docker`
/// process; Docker 18.09+ tunnels the daemon socket over SSH using the local
/// `ssh` binary.
#[allow(clippy::too_many_arguments)]
async fn create_docker_session(
    container_id: &str,
    ssh_connection_id: Option<&str>,
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    // Resolve SSH connection if this is a remote Docker session.
    let ssh_conn = match ssh_connection_id {
        Some(id) => Some(
            super::ssh::get_connection(id)
                .ok_or_else(|| format!("SSH connection '{}' not found", id))?,
        ),
        None => None,
    };

    // Validate container exists and is running on the target daemon.
    super::docker::validate_container(container_id, ssh_conn.as_ref()).await?;

    // Resolve shell — default to /bin/sh for containers (more universally available)
    let resolved_shell = if shell.is_empty() {
        REMOTE_DEFAULT_SHELL.to_string()
    } else {
        shell.to_string()
    };

    // Validate shell format to block injection attempts
    validate_remote_shell(&resolved_shell)?;

    // Build docker exec command
    let mut cmd = CommandBuilder::new("docker");

    // For remote Docker, set DOCKER_HOST so the local `docker` binary tunnels
    // the daemon socket over SSH. The value is passed as a process env var
    // (not through a shell), so no shell quoting is needed — but
    // `validate_ssh_uri_parts` has already rejected URIs with unusual chars.
    if let Some(conn) = ssh_conn.as_ref() {
        super::docker::validate_ssh_uri_parts(&conn.user, &conn.host)?;
        cmd.env("DOCKER_HOST", super::docker::build_docker_host_uri(conn));
    }

    cmd.arg("exec");
    cmd.arg("-it");

    // Pass env vars as -e flags
    cmd.arg("-e");
    cmd.arg("TERM=xterm-256color");
    cmd.arg("-e");
    cmd.arg("COLORTERM=truecolor");

    // Auto-inject PROMPT_COMMAND so the shell inside the container emits OSC 7
    // cwd updates on each prompt. The server's cwd_watcher picks these up and
    // updates the pane's displayed directory. Only valid for bash/sh targets;
    // zsh/fish ignore PROMPT_COMMAND.
    if shell_supports_prompt_command(&resolved_shell) {
        cmd.arg("-e");
        cmd.arg(format!("PROMPT_COMMAND={}", OSC7_PROMPT_COMMAND));
    }

    let safe_env = terminar_core::engine::filter_env(env);
    for (k, v) in &safe_env {
        cmd.arg("-e");
        cmd.arg(format!("{}={}", k, v));
    }

    // Working directory inside container
    let resolved_cwd = if cwd.is_empty() { "/" } else { cwd };
    if resolved_cwd != "/" {
        cmd.arg("-w");
        cmd.arg(resolved_cwd);
    }

    // `--` separator terminates option parsing so a container_id like `--tls`
    // can't be interpreted as a Docker flag.
    cmd.arg("--");
    cmd.arg(container_id);
    cmd.arg(&resolved_shell);

    // Look up container name for display
    let container_name = super::docker::get_container_name(container_id, ssh_conn.as_ref()).await;
    let display_name = container_name.as_deref().unwrap_or(container_id);
    let name = match ssh_conn.as_ref() {
        Some(conn) => format!("{}/{}: Terminal {}", conn.name, display_name, counter),
        None => format!("{}: Terminal {}", display_name, counter),
    };

    terminar_core::engine::create_session_with_command(
        None,
        &name,
        &resolved_shell,
        resolved_cwd,
        cols,
        rows,
        cmd,
        sessions,
        state.mock_provider.as_ref(),
        None,
        Some(container_id.to_string()),
        ssh_connection_id.map(|s| s.to_string()),
    )
    .map_err(|e| format!("Failed to create Docker session: {}", e))
}

/// Create an SSH session by wrapping `ssh -tt user@host` in a PTY.
#[allow(clippy::too_many_arguments)]
fn create_ssh_session(
    ssh_connection_id: &str,
    cwd: &str,
    shell: &str,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    // Look up connection
    let conn = super::ssh::get_connection(ssh_connection_id)
        .ok_or_else(|| format!("SSH connection '{}' not found", ssh_connection_id))?;

    // Default shell if empty — /bin/sh is more universal on remote hosts
    let resolved_shell = if shell.is_empty() {
        REMOTE_DEFAULT_SHELL.to_string()
    } else {
        shell.to_string()
    };

    // Validate shell format to block injection attempts (defense layer A)
    validate_remote_shell(&resolved_shell)?;

    // Build ssh command
    let mut cmd = CommandBuilder::new("ssh");
    cmd.arg("-tt");
    cmd.arg("-o");
    cmd.arg("ServerAliveInterval=30");
    cmd.arg("-o");
    cmd.arg("ServerAliveCountMax=3");
    cmd.arg("-p");
    cmd.arg(conn.port.to_string());
    cmd.arg(format!("{}@{}", conn.user, conn.host));

    // Wrap remote command: optional `cd`, optional PROMPT_COMMAND injection
    // for bash/sh (so the remote shell auto-emits OSC 7 cwd updates), then
    // exec the target shell. Both cwd and shell are shell-quoted inside
    // `build_ssh_remote_command` as a defense layer on top of
    // `validate_remote_shell()`.
    let remote_cmd = build_ssh_remote_command(cwd, &resolved_shell);
    cmd.arg(remote_cmd);

    let name = format!("{}: Terminal {}", conn.name, counter);

    terminar_core::engine::create_session_with_command(
        None,
        &name,
        &resolved_shell,
        cwd,
        cols,
        rows,
        cmd,
        sessions,
        state.mock_provider.as_ref(),
        None,
        None,
        Some(ssh_connection_id.to_string()),
    )
    .map_err(|e| format!("Failed to create SSH session: {}", e))
}

/// POSIX shell-quote: wrap in single quotes, escape embedded single quotes.
pub(crate) fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Handle RenameSession message.
#[instrument(skip(tx_out, sessions), fields(session_id = %session_id, new_name = %new_name))]
pub(crate) async fn handle_rename_session(
    session_id: &str,
    new_name: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    {
        let mut guard = sessions.lock();
        if let Some(session) = guard.get_mut(session_id) {
            session.name = new_name.to_string();
        }
    }
    let list = enrich_session_list(build_session_list(sessions));
    tx_out
        .send(ServerMessage::SessionList { sessions: list })
        .await?;
    Ok(())
}

/// Handle KillSession message.
#[instrument(skip(tx_out, sessions, _state), fields(session_id = %session_id))]
pub(crate) async fn handle_kill_session(
    session_id: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    _state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    let was_removed = {
        let mut guard = sessions.lock();
        guard.remove(session_id).is_some()
    };
    let list = enrich_session_list(build_session_list(sessions));

    if was_removed {
        info!(session_id = %session_id, event = "session_killed", "Session lifecycle: killed");
        // Delete history file and update metadata
        let base_path = crate::settings::get_settings_dir();
        persistence::delete_history(&base_path, session_id);
        persistence::persist_all(&base_path, sessions);
        tx_out
            .send(ServerMessage::SessionClosed {
                session_id: session_id.to_string(),
            })
            .await?;
        tx_out
            .send(ServerMessage::SessionList { sessions: list })
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- shell_quote ----

    #[test]
    fn shell_quote_empty() {
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn shell_quote_plain() {
        assert_eq!(shell_quote("hello"), "'hello'");
    }

    #[test]
    fn shell_quote_space() {
        assert_eq!(shell_quote("hello world"), "'hello world'");
    }

    #[test]
    fn shell_quote_single_quote() {
        // A single quote becomes '\'' when wrapped in single quotes.
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn shell_quote_consecutive_quotes() {
        assert_eq!(shell_quote("a''b"), "'a'\\'''\\''b'");
    }

    #[test]
    fn shell_quote_backslash() {
        // Single quotes disable backslash interpretation, so no special handling needed.
        assert_eq!(shell_quote("a\\b"), "'a\\b'");
    }

    #[test]
    fn shell_quote_dollar_and_backtick() {
        assert_eq!(shell_quote("$(echo)`ls`"), "'$(echo)`ls`'");
    }

    #[test]
    fn shell_quote_newline() {
        assert_eq!(shell_quote("a\nb"), "'a\nb'");
    }

    #[test]
    fn shell_quote_null_byte() {
        // Null byte stays as-is; the shell will truncate but that's not our concern.
        assert_eq!(shell_quote("a\0b"), "'a\0b'");
    }

    #[test]
    fn shell_quote_unicode() {
        assert_eq!(shell_quote("héllo🔥"), "'héllo🔥'");
    }

    #[test]
    fn shell_quote_metacharacters_neutralized() {
        // All common shell metacharacters should pass through literally.
        let meta = "; & | < > $ ` ( ) { } [ ] * ? ! ~ # \\";
        assert_eq!(shell_quote(meta), format!("'{}'", meta));
    }

    // ---- validate_remote_shell ----

    #[test]
    fn validate_remote_shell_accepts_common() {
        for shell in &[
            "/bin/bash",
            "/bin/sh",
            "/bin/zsh",
            "/bin/ash",
            "/bin/busybox",
            "/usr/local/bin/fish",
            "/opt/homebrew/bin/bash",
        ] {
            assert!(
                validate_remote_shell(shell).is_ok(),
                "should accept {}",
                shell
            );
        }
    }

    #[test]
    fn validate_remote_shell_rejects_empty() {
        assert!(validate_remote_shell("").is_err());
    }

    #[test]
    fn validate_remote_shell_rejects_relative() {
        assert!(validate_remote_shell("bash").is_err());
        assert!(validate_remote_shell("./bash").is_err());
    }

    #[test]
    fn validate_remote_shell_rejects_metacharacters() {
        for bad in &[
            "/bin/bash; rm -rf /",
            "/bin/bash && echo pwned",
            "/bin/bash|foo",
            "/bin/bash`id`",
            "/bin/bash$(id)",
            "/bin/bash > /tmp/pwn",
            "/bin/bash < /etc/passwd",
            "/bin/bash\nmalicious",
            "/bin/bash\rinjection",
            "/bin/bash\0null",
            "/bin/bash\\x",
            "/bin/bash with space",
            "/bin/bash\twith\ttab",
            "/bin/\"bash\"",
            "/bin/'bash'",
        ] {
            assert!(
                validate_remote_shell(bad).is_err(),
                "should reject {:?}",
                bad
            );
        }
    }

    #[test]
    fn validate_remote_shell_rejects_too_long() {
        let too_long = format!("/{}", "a".repeat(300));
        assert!(validate_remote_shell(&too_long).is_err());
    }

    #[test]
    fn validate_remote_shell_accepts_max_length() {
        let max_len = format!("/{}", "a".repeat(255));
        assert_eq!(max_len.len(), 256);
        assert!(validate_remote_shell(&max_len).is_ok());
    }

    // ---- shell_basename / shell_supports_prompt_command ----

    #[test]
    fn shell_basename_extracts_final_component() {
        assert_eq!(shell_basename("/bin/bash"), "bash");
        assert_eq!(shell_basename("/usr/local/bin/zsh"), "zsh");
        assert_eq!(shell_basename("/bin/sh"), "sh");
        assert_eq!(shell_basename("/opt/homebrew/bin/fish"), "fish");
        assert_eq!(shell_basename(""), "");
    }

    #[test]
    fn supports_prompt_command_bash_family() {
        assert!(shell_supports_prompt_command("/bin/bash"));
        assert!(shell_supports_prompt_command("/usr/bin/bash"));
        assert!(shell_supports_prompt_command("/opt/homebrew/bin/bash"));
        assert!(shell_supports_prompt_command("/bin/sh"));
    }

    #[test]
    fn supports_prompt_command_rejects_zsh_fish_and_others() {
        assert!(!shell_supports_prompt_command("/bin/zsh"));
        assert!(!shell_supports_prompt_command("/usr/local/bin/fish"));
        assert!(!shell_supports_prompt_command("/bin/ash"));
        assert!(!shell_supports_prompt_command("/bin/dash"));
        assert!(!shell_supports_prompt_command("/bin/tcsh"));
        assert!(!shell_supports_prompt_command(""));
    }

    // ---- build_ssh_remote_command ----

    /// Every bash/zsh shim must define these aliases so programs that shell
    /// out to these binaries get transparently redirected to OSC sequences.
    fn assert_shim_contains_all_aliases(cmd: &str) {
        for needle in &[
            "pbcopy()",
            "xclip()",
            "xsel()",
            "wl-copy()",
            "_terminar_open_url()",
            "open()",
            "xdg-open()",
            "export BROWSER=_terminar_open_url",
            r#"\033]52;c;%s\007"#,    // OSC 52 emit (clipboard)
            r#"\033]7777;open_url;%s\007"#, // OSC 7777 emit (URL open)
        ] {
            assert!(
                cmd.contains(needle),
                "expected shim to contain {:?}, got:\n{}",
                needle,
                cmd
            );
        }
    }

    #[test]
    fn ssh_remote_cmd_bash_with_cwd_injects_shim_and_prompt_command() {
        let cmd = build_ssh_remote_command("/home/dev", "/bin/bash");
        assert!(cmd.starts_with("cd '/home/dev' && "));
        assert_shim_contains_all_aliases(&cmd);
        // bash must export the shim functions so they survive `exec bash`.
        assert!(
            cmd.contains("export -f pbcopy xclip xsel wl-copy _terminar_open_url open xdg-open"),
            "bash path must export shim functions"
        );
        // Cwd tracking still uses PROMPT_COMMAND for bash.
        assert!(cmd.contains("PROMPT_COMMAND='printf "));
        assert!(cmd.contains(r#"\033]7;file://%s%s\007"#));
        assert!(cmd.contains(r#""${HOSTNAME:-$(hostname)}""#));
        assert!(cmd.ends_with(" exec '/bin/bash'"));
    }

    #[test]
    fn ssh_remote_cmd_bash_no_cwd_skips_cd() {
        let cmd = build_ssh_remote_command("", "/bin/bash");
        assert!(!cmd.contains("cd "));
        // First non-empty token must be `pbcopy()` — the start of the shim.
        assert!(cmd.starts_with("pbcopy()"));
        assert!(cmd.ends_with(" exec '/bin/bash'"));
    }

    #[test]
    fn ssh_remote_cmd_bash_root_cwd_skips_cd() {
        let cmd = build_ssh_remote_command("/", "/bin/bash");
        assert!(!cmd.contains("cd "));
        assert!(cmd.starts_with("pbcopy()"));
    }

    #[test]
    fn ssh_remote_cmd_sh_also_injects_shim() {
        let cmd = build_ssh_remote_command("/tmp", "/bin/sh");
        assert_shim_contains_all_aliases(&cmd);
        assert!(cmd.contains("PROMPT_COMMAND="));
        assert!(cmd.ends_with(" exec '/bin/sh'"));
    }

    #[test]
    fn ssh_remote_cmd_zsh_uses_zdotdir_with_shim() {
        let cmd = build_ssh_remote_command("/home/dev", "/bin/zsh");
        assert!(cmd.starts_with("cd '/home/dev' && "));
        // zsh path writes a temp .zshrc via heredoc and sets ZDOTDIR.
        assert!(cmd.contains("TERMINAR_ZDOTDIR=$(mktemp -d"));
        assert!(cmd.contains(".zshrc"));
        assert!(cmd.contains("<<'TERMINAR_SHIM_EOF'"));
        assert!(cmd.contains("TERMINAR_SHIM_EOF\n"));
        // User's .zshrc sourced first so their config is preserved.
        assert!(cmd.contains(r#"[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc""#));
        // Shim defined after user config so ours wins.
        assert_shim_contains_all_aliases(&cmd);
        // Cwd tracking via zsh-native precmd hook.
        assert!(cmd.contains("add-zsh-hook precmd _terminar_cwd"));
        // Final exec uses ZDOTDIR to pick up the custom .zshrc.
        assert!(cmd.contains(r#"ZDOTDIR="$TERMINAR_ZDOTDIR" exec '/bin/zsh'"#));
    }

    #[test]
    fn ssh_remote_cmd_zsh_no_cwd_skips_cd() {
        let cmd = build_ssh_remote_command("", "/bin/zsh");
        assert!(!cmd.contains("cd '"));
        assert!(cmd.starts_with("TERMINAR_ZDOTDIR="));
    }

    #[test]
    fn ssh_remote_cmd_fish_falls_back_to_plain_exec() {
        let cmd = build_ssh_remote_command("", "/usr/local/bin/fish");
        assert_eq!(cmd, "exec '/usr/local/bin/fish'");
    }

    #[test]
    fn ssh_remote_cmd_ash_falls_back_to_plain_exec() {
        let cmd = build_ssh_remote_command("/tmp", "/bin/ash");
        assert_eq!(cmd, "cd '/tmp' && exec '/bin/ash'");
    }

    #[test]
    fn ssh_remote_cmd_quotes_paths_with_metacharacters() {
        let cmd = build_ssh_remote_command("/tmp/with'quote", "/bin/bash");
        // The embedded single-quote is escaped via `'\''` in POSIX quoting.
        assert!(cmd.contains(r"'/tmp/with'\''quote'"));
    }

    #[test]
    fn ssh_remote_cmd_prompt_command_is_single_quoted() {
        // The OSC7_PROMPT_COMMAND value must be wrapped in single quotes so
        // the login shell treats it as a literal string (no expansion until
        // bash re-evaluates it at prompt time).
        let cmd = build_ssh_remote_command("", "/bin/bash");
        let pc_start = cmd.find("PROMPT_COMMAND='").expect("PROMPT_COMMAND= not found");
        let after_start = &cmd[pc_start + "PROMPT_COMMAND='".len()..];
        let exec_pos = after_start.find(" exec ").expect("exec not found");
        let pc_value = &after_start[..exec_pos];
        assert!(pc_value.ends_with('\''), "PROMPT_COMMAND value not terminated by single quote: {}", pc_value);
    }

    // ---- expand_tilde ----

    fn env_with_home(home: &str) -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("HOME".to_string(), home.to_string());
        m
    }

    #[test]
    fn expand_tilde_prefix() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("~/code", &env), "/Users/me/code");
    }

    #[test]
    fn expand_tilde_bare() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("~", &env), "/Users/me");
    }

    #[test]
    fn expand_tilde_absolute_untouched() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("/tmp/x", &env), "/tmp/x");
    }

    #[test]
    fn expand_tilde_empty_untouched() {
        let env = env_with_home("/Users/me");
        assert_eq!(expand_tilde("", &env), "");
    }

    #[test]
    fn expand_tilde_tilde_in_middle_untouched() {
        let env = env_with_home("/Users/me");
        // Only a leading `~/` triggers expansion.
        assert_eq!(expand_tilde("/path/~/foo", &env), "/path/~/foo");
    }

    #[test]
    fn expand_tilde_trailing_slash_in_home() {
        let env = env_with_home("/Users/me/");
        assert_eq!(expand_tilde("~/code", &env), "/Users/me/code");
    }
}
