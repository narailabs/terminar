//! Session lifecycle message handlers: CreateSession, KillSession, RenameSession, ListSessions.

use crate::AppState;
use crate::messages::{ServerMessage, SessionInfo};
use crate::persistence;
use crate::session::SessionMap;

use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{info, instrument};

// Re-export core engine functions used by other handler modules
pub use terminar_core::engine::{clamp_dimension, filter_env};

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
    let list = build_session_list(sessions);
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
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    // Resolve shell - use system default if empty
    let resolved_shell = terminar_core::engine::resolve_shell(shell);
    // Resolve cwd - use home directory if empty or "/"
    let resolved_cwd = terminar_core::engine::resolve_cwd(cwd);

    // Validate shell against whitelist before spawning
    if let Some(error_msg) = terminar_core::engine::validate_shell(&resolved_shell) {
        tx_out
            .send(ServerMessage::Error {
                message: error_msg,
                error_code: Some("INVALID_INPUT".to_string()),
            })
            .await?;
        return Ok(());
    }

    // Validate working directory
    if let Some(error_msg) = terminar_core::engine::validate_cwd(&resolved_cwd) {
        tx_out
            .send(ServerMessage::Error {
                message: error_msg,
                error_code: Some("INVALID_INPUT".to_string()),
            })
            .await?;
        return Ok(());
    }

    // Clamp dimensions to valid range (1-500)
    let cols = terminar_core::engine::clamp_dimension(cols, "cols");
    let rows = terminar_core::engine::clamp_dimension(rows, "rows");

    let name = format!(
        "Terminal {}",
        state
            .session_name_counter
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );

    // Map to Result<String, String> so the non-Send error is dropped before any .await
    let result = terminar_core::engine::create_session(
        None,
        &name,
        &resolved_shell,
        &resolved_cwd,
        cols,
        rows,
        env,
        sessions,
        state.mock_provider.as_ref(),
        None,
    )
    .map_err(|e| format!("Failed to create session: {}", e));

    match result {
        Ok(_id) => {
            state
                .sessions_total
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let list = build_session_list(sessions);
            tx_out
                .send(ServerMessage::SessionList { sessions: list })
                .await?;
        }
        Err(msg) => {
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

/// Handle RenameSession message.
#[instrument(skip(tx_out, sessions), fields(session_id = %session_id, new_name = %new_name))]
pub(crate) async fn handle_rename_session(
    session_id: &str,
    new_name: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    let list = {
        let mut guard = sessions.lock();
        if let Some(session) = guard.get_mut(session_id) {
            session.name = new_name.to_string();
        }
        guard
            .values()
            .map(|s| SessionInfo {
                id: s.id.clone(),
                name: s.name.clone(),
                shell: s.shell_cmd.clone(),
                cwd: s.cwd.clone(),
                started_at: "now".to_string(),
                state: Some(s.state.display_name().to_string()),
                foreground_process: s.foreground_process.clone(),
                last_activity_at: s.last_output_at.lock().map(|_| "now".to_string()),
                exit_code: s.exit_code,
            })
            .collect::<Vec<_>>()
    };
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
    let (was_removed, list) = {
        let mut guard = sessions.lock();
        let removed = guard.remove(session_id).is_some();
        let list = guard
            .values()
            .map(|s| SessionInfo {
                id: s.id.clone(),
                name: s.name.clone(),
                shell: s.shell_cmd.clone(),
                cwd: s.cwd.clone(),
                started_at: "now".to_string(),
                state: Some(s.state.display_name().to_string()),
                foreground_process: s.foreground_process.clone(),
                last_activity_at: s.last_output_at.lock().map(|_| "now".to_string()),
                exit_code: s.exit_code,
            })
            .collect::<Vec<_>>();
        (removed, list)
    };

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
