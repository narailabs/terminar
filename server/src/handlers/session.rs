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

    let result = if let Some(cid) = container_id {
        // Docker container session
        create_docker_session(cid, cwd, shell, env, cols, rows, counter, sessions, state).await
    } else if let Some(sid) = ssh_connection_id {
        // SSH session
        create_ssh_session(sid, cwd, shell, cols, rows, counter, sessions, state)
    } else {
        // Local shell session
        create_local_session(cwd, shell, env, cols, rows, counter, sessions, state)
    };

    match result {
        Ok(_id) => {
            state
                .sessions_total
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
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
    let resolved_cwd = terminar_core::engine::resolve_cwd(cwd);

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

/// Create a Docker container session via `docker exec`.
#[allow(clippy::too_many_arguments)]
async fn create_docker_session(
    container_id: &str,
    cwd: &str,
    shell: &str,
    env: &HashMap<String, String>,
    cols: u16,
    rows: u16,
    counter: u64,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<String, String> {
    // Validate container exists and is running
    super::docker::validate_container(container_id).await?;

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
    cmd.arg("exec");
    cmd.arg("-it");

    // Pass env vars as -e flags
    cmd.arg("-e");
    cmd.arg("TERM=xterm-256color");
    cmd.arg("-e");
    cmd.arg("COLORTERM=truecolor");

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
    let container_name = super::docker::get_container_name(container_id).await;
    let display_name = container_name.as_deref().unwrap_or(container_id);
    let name = format!("{}: Terminal {}", display_name, counter);

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
        None,
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

    // Wrap remote command: cd + exec shell. Both cwd and shell are shell-quoted
    // (defense layer B) so that even if validate_remote_shell has a gap, the
    // remote shell can't interpret metacharacters.
    let remote_cmd = if !cwd.is_empty() && cwd != "/" {
        format!(
            "cd {} && exec {}",
            shell_quote(cwd),
            shell_quote(&resolved_shell)
        )
    } else {
        format!("exec {}", shell_quote(&resolved_shell))
    };
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
}
