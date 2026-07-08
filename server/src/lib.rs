//! terminar Server library.
//!
//! This crate implements the backend for the terminar terminal application.
//! It manages terminal sessions via PTY processes, exposes them over a Unix
//! domain socket (the only transport — this build has no network support),
//! and supports session persistence, history compression, and graceful shutdown.

pub mod audit;
pub mod config;
pub mod constants;
pub mod cwd_watcher;
pub mod error;
pub mod handlers;
pub mod logging;
pub mod messages;
pub mod osc_parser;
pub mod settings;
pub mod shell_init;
pub mod tags;
pub mod themes;
pub mod workspace;

// Re-export core modules from terminar_core for backward compatibility.
// Server code can use `crate::session::*`, `crate::pty::*`, etc.
pub use terminar_core::history;
pub use terminar_core::persistence;
pub use terminar_core::process;
pub use terminar_core::pty;
pub use terminar_core::session;

use config::Cli;
use messages::{ClientMessage, ServerMessage};
use pty::MockPtyProvider;
use session::SessionMap;

use parking_lot::Mutex; // Non-poisoning mutex - doesn't require unwrap()
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::UnixListener;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, trace, warn};

use constants::SHUTDOWN_TIMEOUT_SECS;

// Re-export handler functions used by tests in this module
#[cfg(test)]
use handlers::session::{clamp_dimension, filter_env};
#[cfg(test)]
use session::SessionState;

// Re-export PTY_READ_BUFFER_SIZE for backward compatibility
pub use constants::PTY_READ_BUFFER_SIZE;

/// Polls all active sessions for foreground process changes.
///
/// For each running session with a valid PTY fd, calls `get_foreground_process()`
/// and compares with the current value. If changed, updates the session and
/// broadcasts a `ForegroundChanged` notification to attached clients.
///
/// Sessions in Closed, Error, or Exited state are skipped.
fn poll_foreground_processes(sessions: &SessionMap) {
    let mut guard = sessions.lock();
    for session in guard.values_mut() {
        // Skip sessions that aren't running
        match session.state {
            session::SessionState::Running => {}
            _ => continue,
        }

        // Skip Docker and SSH sessions — tcgetpgrp returns the local process, not the remote shell
        if session.container_id.is_some() || session.ssh_connection_id.is_some() {
            continue;
        }

        // Skip sessions without a PTY fd (e.g., mock PTYs)
        let pty_fd = match session.pty_fd {
            Some(fd) => fd,
            None => continue,
        };

        let new_process = process::get_foreground_process(pty_fd);

        // Only broadcast if the process name actually changed
        if new_process != session.foreground_process {
            let old = session.foreground_process.clone();
            session.foreground_process = new_process.clone();
            tracing::debug!(
                session_id = %session.id,
                old_process = ?old,
                new_process = ?new_process,
                "Foreground process changed"
            );

            // Broadcast ForegroundChanged to attached clients
            let _ = session
                .output_tx
                .send(session::SessionEvent::ForegroundChanged(
                    new_process.clone(),
                ));
        }

        // Poll CWD of the foreground process
        let new_cwd = process::get_process_cwd(pty_fd);
        if let Some(ref cwd) = new_cwd
            && *cwd != session.cwd
        {
            let old = session.cwd.clone();
            session.cwd = cwd.clone();
            tracing::debug!(
                session_id = %session.id,
                old_cwd = %old,
                new_cwd = %cwd,
                "CWD changed"
            );
            let _ = session
                .output_tx
                .send(session::SessionEvent::CwdChanged(cwd.clone()));
        }
    }
}

/// Check for silence in active sessions and send silence notifications.
/// Runs periodically (every 5 seconds) and checks if `last_output_at` is older
/// than the session's silence threshold. If so, sends a Silence event.
fn check_silence(sessions: &SessionMap) {
    let guard = sessions.lock();
    for session in guard.values() {
        // Only check running sessions
        match session.state {
            session::SessionState::Running => {}
            _ => continue,
        }

        // Skip if already notified about silence
        if session
            .silence_notified
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            continue;
        }

        // Skip if no output has ever been received
        let last_output = match *session.last_output_at.lock() {
            Some(t) => t,
            None => continue,
        };

        // Check if silence threshold has been exceeded
        let elapsed = last_output.elapsed();
        if elapsed >= Duration::from_secs(session.silence_threshold_secs) {
            session
                .silence_notified
                .store(true, std::sync::atomic::Ordering::Relaxed);
            tracing::debug!(
                session_id = %session.id,
                elapsed_secs = elapsed.as_secs(),
                threshold_secs = session.silence_threshold_secs,
                "Silence detected"
            );
            // Only send if there are subscribers (attached clients)
            if session.output_tx.receiver_count() > 0 {
                let _ = session.output_tx.send(session::SessionEvent::Silence);
            }
        }
    }
}

/// Shared application state passed to the Unix-socket connection handlers.
///
/// All mutable fields use `Arc` wrappers for safe concurrent access.
#[derive(Clone)]
pub struct AppState {
    /// Map of session ID to active `Session` objects.
    pub sessions: SessionMap,
    /// Optional mock PTY provider for testing without real terminal processes.
    pub mock_provider: Option<Arc<MockPtyProvider>>,
    /// Broadcast channel for signaling graceful shutdown to all server tasks.
    pub shutdown_tx: broadcast::Sender<()>,
    /// Server start time, used for uptime calculation.
    pub start_time: Instant,
    /// Monotonically increasing counter of total sessions created since server start.
    pub sessions_total: Arc<std::sync::atomic::AtomicU64>,
    /// Monotonically increasing counter of total protocol messages processed.
    pub messages_processed_total: Arc<std::sync::atomic::AtomicU64>,
    /// Monotonically increasing counter for auto-naming sessions ("Terminal 1", "Terminal 2", etc.).
    pub session_name_counter: Arc<std::sync::atomic::AtomicU64>,
    /// Optional audit logger for security event tracking.
    pub audit_logger: Option<Arc<audit::AuditLogger>>,
    /// Broadcast channel for server-originated tool-action events that are
    /// parsed from a session's output stream (clipboard writes, URL opens)
    /// and routed back to attached clients for execution on the local system.
    ///
    /// The tuple is `(session_id, ServerMessage)`; the `ServerMessage` is
    /// already-constructed (e.g. `ServerMessage::ClipboardWrite { .. }`) so
    /// `handle_attach` just has to filter by `session_id` and forward it
    /// verbatim to the connected client.
    ///
    /// We use a single server-wide broadcast channel rather than per-session
    /// channels because attached clients tune in dynamically and broadcast
    /// is the simplest way to fan out without per-session bookkeeping.
    pub tool_action_tx: broadcast::Sender<(String, messages::ServerMessage)>,
}

/// Starts the terminar server, listening on a Unix domain socket only.
///
/// This is the main entry point for the server. It initializes logging, loads
/// persisted sessions, binds the Unix socket listener, and waits for
/// SIGTERM/SIGINT for graceful shutdown.
pub async fn run_server(cli: Cli, socket_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging with CLI-configured options (JSON, file, level)
    // The guard must be held for the lifetime of the server to flush file logs
    let _log_guard = logging::init_logging(&cli);

    let start_time = Instant::now();
    info!("Starting terminar Server...");

    let sessions: SessionMap = Arc::new(Mutex::new(HashMap::new()));

    // Restore persisted sessions on startup.
    // Create new PTY sessions with the original IDs, names, and cwd
    // but without old scrollback — terminals start fresh after restart.
    let mut initial_name_counter: u64 = 1;
    let base_path = settings::get_settings_dir();
    let session_file = persistence::get_session_file_path(&base_path);
    match persistence::load_sessions(&session_file.to_string_lossy()) {
        Ok(data) => {
            let running_sessions: Vec<_> = data
                .sessions
                .iter()
                .filter(|s| s.state == "Running")
                .collect();
            if !running_sessions.is_empty() {
                info!(
                    "Restoring {} persisted session(s)...",
                    running_sessions.len()
                );
                for s in &running_sessions {
                    // Track "Terminal N" counter
                    if let Some(n) = s.name.strip_prefix("Terminal ")
                        && let Ok(num) = n.parse::<u64>()
                        && num >= initial_name_counter
                    {
                        initial_name_counter = num + 1;
                    }

                    // Skip remote sessions (Docker/SSH) — Phase 1 does not restore
                    // them because there's no agent to reattach to, and blindly
                    // re-spawning would misleadingly show the docker/ssh badge on
                    // a session that's actually running locally.
                    if s.container_id.is_some() {
                        info!(
                            "Skipping restore of Docker session {} ({}): Phase 1 does not restore remote sessions",
                            s.id, s.name
                        );
                        continue;
                    }
                    if s.ssh_connection_id.is_some() {
                        info!(
                            "Skipping restore of SSH session {} ({}): Phase 1 does not restore remote sessions",
                            s.id, s.name
                        );
                        continue;
                    }

                    // Validate shell and cwd before restoring
                    let shell = terminar_core::engine::resolve_shell(&s.shell_cmd);
                    let cwd_candidate = terminar_core::engine::resolve_cwd(&s.cwd);
                    if terminar_core::engine::validate_shell(&shell).is_some() {
                        warn!(
                            "Skipping restore of session {} with invalid shell: {}",
                            s.id, shell
                        );
                        continue;
                    }
                    if terminar_core::engine::validate_cwd(&cwd_candidate).is_some() {
                        warn!(
                            "Skipping restore of session {} with invalid cwd: {} (using home dir)",
                            s.id, s.cwd
                        );
                        // Fall through with home dir
                    }

                    match terminar_core::engine::create_session(
                        Some(&s.id),
                        &s.name,
                        &shell,
                        &cwd_candidate,
                        80,
                        24,
                        &HashMap::new(),
                        &sessions,
                        cli.mock_pty.then(|| Arc::new(MockPtyProvider)).as_ref(),
                        None, // Don't replay old buffer — fresh terminal, same cwd
                    ) {
                        Ok(id) => info!("Restored session {} ({})", id, s.name),
                        Err(e) => warn!("Failed to restore session {}: {}", s.id, e),
                    }
                }
            }
        }
        Err(e) => {
            warn!("Failed to load persisted sessions: {} (starting fresh)", e);
        }
    }

    let mock_provider = if cli.mock_pty {
        info!("Using MOCK PTY Provider (Echo Mode)");
        Some(Arc::new(MockPtyProvider))
    } else {
        None
    };

    // Create shutdown broadcast channel
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    // Create tool-action broadcast channel. Capacity 256 is enough for short
    // bursts of clipboard/URL events; lagged clients drop old messages which
    // is the right behavior (we don't want to block PTY output on a slow UI).
    let (tool_action_tx, _) = broadcast::channel(256);

    let mut state = AppState {
        sessions: sessions.clone(),
        mock_provider,
        shutdown_tx: shutdown_tx.clone(),
        start_time: Instant::now(),
        sessions_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        messages_processed_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        session_name_counter: Arc::new(std::sync::atomic::AtomicU64::new(initial_name_counter)),
        audit_logger: None, // Will be replaced after async init
        tool_action_tx,
    };

    // Initialize audit logger
    let audit_level: audit::AuditLevel = cli.audit_level.parse().unwrap_or(audit::AuditLevel::Off);
    if audit_level != audit::AuditLevel::Off {
        let audit_path =
            std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
                .join(".terminar")
                .join("audit.log");
        match audit::AuditLogger::new(audit_path.clone(), audit_level).await {
            Ok(logger) => {
                info!("Audit logging enabled, writing to {:?}", audit_path);
                state.audit_logger = Some(Arc::new(logger));
            }
            Err(e) => {
                warn!(
                    "Failed to initialize audit logger: {} (audit logging disabled)",
                    e
                );
            }
        }
    } else {
        info!("Audit logging disabled");
    }

    // Start the Unix Socket Server (the only listener — this build has no
    // network/HTTP/WebSocket support).
    let socket_path_owned = socket_path.to_string();
    if std::path::Path::new(socket_path).exists() {
        std::fs::remove_file(socket_path)?;
    }
    let listener_unix = UnixListener::bind(socket_path)?;
    info!("Unix Socket listening on {}", socket_path);

    // Save references before state is moved into spawned tasks
    let audit_logger_for_shutdown = state.audit_logger.clone();

    let sessions_unix = sessions.clone();
    let mut unix_shutdown_rx = shutdown_tx.subscribe();
    let unix_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = listener_unix.accept() => {
                    match result {
                        Ok((socket, _)) => {
                            let sess = sessions_unix.clone();
                            let st = state.clone();
                            tokio::spawn(async move {
                                if let Err(e) = handle_connection(socket, sess, st).await {
                                    error!("Unix Connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => error!("Accept error: {}", e),
                    }
                }
                _ = unix_shutdown_rx.recv() => {
                    info!("Unix socket server received shutdown signal");
                    break;
                }
            }
        }
    });

    // 3. Start foreground process polling task
    let fg_sessions = sessions.clone();
    let mut fg_shutdown_rx = shutdown_tx.subscribe();
    let _fg_poll_task = tokio::spawn(async move {
        let poll_interval = Duration::from_secs(2);
        loop {
            tokio::select! {
                _ = tokio::time::sleep(poll_interval) => {
                    poll_foreground_processes(&fg_sessions);
                }
                _ = fg_shutdown_rx.recv() => {
                    info!("Foreground process polling task received shutdown signal");
                    break;
                }
            }
        }
    });

    // 4. Start silence checker task (Activity Monitoring - F3a)
    let silence_sessions = sessions.clone();
    let mut silence_shutdown_rx = shutdown_tx.subscribe();
    let _silence_task = tokio::spawn(async move {
        let check_interval = Duration::from_secs(5);
        loop {
            tokio::select! {
                _ = tokio::time::sleep(check_interval) => {
                    check_silence(&silence_sessions);
                }
                _ = silence_shutdown_rx.recv() => {
                    info!("Silence checker task received shutdown signal");
                    break;
                }
            }
        }
    });

    // 5. Start periodic session persistence task
    let persist_sessions = sessions.clone();
    let persist_base_path = settings::get_settings_dir();
    let mut persist_shutdown_rx = shutdown_tx.subscribe();
    let _persist_task = tokio::spawn(async move {
        let save_interval = Duration::from_secs(constants::PERIODIC_SAVE_INTERVAL_SECS);
        loop {
            tokio::select! {
                _ = tokio::time::sleep(save_interval) => {
                    persistence::persist_all(&persist_base_path, &persist_sessions);
                }
                _ = persist_shutdown_rx.recv() => {
                    info!("Periodic persistence task received shutdown signal");
                    break;
                }
            }
        }
    });

    // 6. Wait for shutdown signal (SIGTERM or SIGINT)
    let shutdown_signal = async {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{SignalKind, signal};
            let mut sigterm =
                signal(SignalKind::terminate()).expect("Failed to install SIGTERM handler");
            let mut sigint =
                signal(SignalKind::interrupt()).expect("Failed to install SIGINT handler");

            tokio::select! {
                _ = sigterm.recv() => {
                    info!("Received SIGTERM signal");
                }
                _ = sigint.recv() => {
                    info!("Received SIGINT signal");
                }
            }
        }
        #[cfg(not(unix))]
        {
            tokio::signal::ctrl_c()
                .await
                .expect("Failed to install Ctrl+C handler");
            info!("Received Ctrl+C signal");
        }
    };

    shutdown_signal.await;

    // Begin graceful shutdown
    info!("Initiating graceful shutdown...");

    // Count sessions before shutdown
    let session_count = {
        let guard = sessions.lock();
        guard.len()
    };

    // Notify all sessions to close (broadcast shutdown signal)
    let _ = shutdown_tx.send(());

    // Wait for tasks with timeout
    let shutdown_timeout = Duration::from_secs(SHUTDOWN_TIMEOUT_SECS);
    let shutdown_result = tokio::time::timeout(shutdown_timeout, async {
        // Abort tasks (they should have received shutdown signal)
        unix_task.abort();

        // Wait a moment for in-flight messages
        tokio::time::sleep(Duration::from_millis(100)).await;
    })
    .await;

    if shutdown_result.is_err() {
        warn!("Shutdown timeout reached, forcing cleanup");
    }

    // Flush audit log before shutdown
    if let Some(ref logger) = audit_logger_for_shutdown {
        info!("Flushing audit log...");
        logger.flush().await;
    }

    // Save session histories and metadata before cleanup
    info!("Saving session histories and metadata...");
    persistence::persist_all(&settings::get_settings_dir(), &sessions);

    // Clean up sessions (kill PTY processes)
    {
        let mut guard = sessions.lock();
        let session_ids: Vec<String> = guard.keys().cloned().collect();
        for id in session_ids {
            if let Some(session) = guard.remove(&id) {
                info!("Cleaning up session {}", session.id);
                // Session's Drop impl will abort reader thread and close PTY
                drop(session);
            }
        }
    }

    // Clean up Unix socket file
    if std::path::Path::new(&socket_path_owned).exists() {
        if let Err(e) = std::fs::remove_file(&socket_path_owned) {
            warn!("Failed to remove socket file: {}", e);
        } else {
            info!("Removed socket file: {}", socket_path_owned);
        }
    }

    // Log final statistics
    let uptime = start_time.elapsed();
    info!(
        "Server shutdown complete. Uptime: {:.1}s, Sessions cleaned: {}",
        uptime.as_secs_f64(),
        session_count
    );

    Ok(())
}

/// Handle Unix socket connection using length-prefixed framing.
/// Frame format: 4-byte big-endian length + JSON payload
/// This prevents protocol corruption when JSON contains newlines or binary data.
async fn handle_connection<S>(
    socket: S,
    sessions: SessionMap,
    state: AppState,
) -> Result<(), Box<dyn std::error::Error>>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut reader, mut writer) = tokio::io::split(socket);
    let (tx_out, mut rx_out) = mpsc::channel::<ServerMessage>(32);

    // Writer task: send messages with length-prefixed framing
    tokio::spawn(async move {
        while let Some(msg) = rx_out.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                let bytes = json.as_bytes();
                let len = bytes.len() as u32;
                // Write 4-byte big-endian length prefix
                if writer.write_all(&len.to_be_bytes()).await.is_err() {
                    break;
                }
                // Write JSON payload
                if writer.write_all(bytes).await.is_err() {
                    break;
                }
            }
        }
    });

    // Unix socket connections are always local - use "local" as client_id for workspace persistence
    let client_id = "local";

    // Reader: read length-prefixed frames
    let mut attach_tasks = handlers::io::AttachTasks::new();
    loop {
        // Read 4-byte length prefix
        let mut len_buf = [0u8; 4];
        match reader.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(_) => break,
        }
        let len = u32::from_be_bytes(len_buf) as usize;

        // Sanity check: reject unreasonably large messages (16MB max)
        if len > 16 * 1024 * 1024 {
            error!("Message too large: {} bytes", len);
            break;
        }

        // Read JSON payload
        let mut payload = vec![0u8; len];
        if reader.read_exact(&mut payload).await.is_err() {
            break;
        }

        // Parse and process
        match String::from_utf8(payload) {
            Ok(json) if !json.trim().is_empty() => {
                match serde_json::from_str::<ClientMessage>(&json) {
                    Ok(msg) => {
                        if let Err(e) = process_message(
                            &msg,
                            &tx_out,
                            &sessions,
                            &state,
                            &mut attach_tasks,
                            client_id,
                        )
                        .await
                        {
                            error!("Process error: {}", e);
                        }
                    }
                    Err(e) => error!("JSON Error: {}", e),
                }
            }
            _ => {}
        }
    }
    // Abort all attach forwarder tasks when the connection closes
    for (_, task) in attach_tasks {
        task.abort();
    }
    Ok(())
}

async fn process_message(
    msg: &ClientMessage,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    state: &AppState,
    attach_tasks: &mut handlers::io::AttachTasks,
    client_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let process_start = Instant::now();
    state
        .messages_processed_total
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    match msg {
        ClientMessage::Input { .. } | ClientMessage::Resize { .. } => {
            trace!("Received message: {:?}", msg);
        }
        _ => {
            info!(message_type = %format!("{:?}", std::mem::discriminant(msg)), "Received message: {:?}", msg);
        }
    }
    let result = process_message_inner(msg, tx_out, sessions, state, attach_tasks, client_id).await;
    let elapsed = process_start.elapsed();
    trace!(
        message_latency_ms = elapsed.as_secs_f64() * 1000.0,
        "Message processed in {:.3}ms",
        elapsed.as_secs_f64() * 1000.0,
    );
    result
}

async fn process_message_inner(
    msg: &ClientMessage,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    state: &AppState,
    attach_tasks: &mut handlers::io::AttachTasks,
    client_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    match msg {
        ClientMessage::ListSessions => {
            handlers::session::handle_list_sessions(tx_out, sessions).await?;
        }
        ClientMessage::CreateSession {
            cwd,
            shell,
            env,
            cols,
            rows,
            container_id,
            ssh_connection_id,
        } => {
            handlers::session::handle_create_session(
                cwd,
                shell,
                env,
                *cols,
                *rows,
                container_id.as_deref(),
                ssh_connection_id.as_deref(),
                tx_out,
                sessions,
                state,
            )
            .await?;
        }
        ClientMessage::RenameSession {
            session_id,
            new_name,
        } => {
            handlers::session::handle_rename_session(session_id, new_name, tx_out, sessions)
                .await?;
        }
        ClientMessage::KillSession { session_id } => {
            handlers::session::handle_kill_session(session_id, tx_out, sessions, state).await?;
        }
        ClientMessage::Attach {
            session_id,
            mode: _,
        } => {
            handlers::io::handle_attach(
                session_id,
                tx_out,
                sessions,
                &state.tool_action_tx,
                attach_tasks,
            )
            .await?;
        }
        ClientMessage::Input { session_id, data } => {
            handlers::io::handle_input(session_id, data, tx_out, sessions).await?;
        }
        ClientMessage::Resize {
            session_id,
            cols,
            rows,
        } => {
            handlers::io::handle_resize(session_id, *cols, *rows, tx_out, sessions).await?;
        }
        ClientMessage::EditReply {
            session_id,
            id,
            contents,
            cancelled,
        } => {
            handlers::io::handle_edit_reply(session_id, id, contents, *cancelled, tx_out, sessions)
                .await?;
        }
        ClientMessage::SaveWorkspace { workspace } => {
            handlers::workspace::handle_save_workspace(client_id, workspace, tx_out).await?;
        }
        ClientMessage::LoadWorkspace => {
            handlers::workspace::handle_load_workspace(client_id, tx_out).await?;
        }
        ClientMessage::GetWorkspaceState => {
            handlers::workspace::handle_get_workspace_state(tx_out).await?;
        }
        ClientMessage::PutWorkspaceState { state } => {
            handlers::workspace::handle_put_workspace_state(state, tx_out).await?;
        }
        ClientMessage::GetSettings => {
            handlers::config::handle_get_settings(tx_out).await?;
        }
        ClientMessage::PutSettings { settings } => {
            handlers::config::handle_put_settings(settings, tx_out).await?;
        }
        ClientMessage::GetThemes => {
            handlers::config::handle_get_themes(tx_out).await?;
        }
        ClientMessage::PutThemes { value } => {
            handlers::config::handle_put_themes(value, tx_out).await?;
        }
        ClientMessage::GetTags => {
            handlers::config::handle_get_tags(tx_out).await?;
        }
        ClientMessage::PutTags { value } => {
            handlers::config::handle_put_tags(value, tx_out).await?;
        }
        ClientMessage::ListContainers { ssh_connection_id } => {
            handlers::docker::handle_list_containers(ssh_connection_id.as_deref(), tx_out).await?;
        }
        ClientMessage::ListSshConnections => {
            handlers::ssh::handle_list_ssh_connections(tx_out).await?;
        }
        ClientMessage::AddSshConnection {
            name,
            host,
            user,
            port,
        } => {
            handlers::ssh::handle_add_ssh_connection(name, host, user, *port, tx_out).await?;
        }
        ClientMessage::UpdateSshConnection {
            id,
            name,
            host,
            user,
            port,
        } => {
            handlers::ssh::handle_update_ssh_connection(id, name, host, user, *port, tx_out)
                .await?;
        }
        ClientMessage::RemoveSshConnection { id } => {
            handlers::ssh::handle_remove_ssh_connection(id, tx_out).await?;
        }
        ClientMessage::ImportSshConfig => {
            handlers::ssh::handle_import_ssh_config(tx_out).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex; // Use parking_lot to match production code
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::mpsc;

    fn create_test_state() -> (AppState, mpsc::Receiver<ServerMessage>) {
        let sessions = Arc::new(Mutex::new(HashMap::new()));

        // Use Mock Pty
        let mock_provider = Some(Arc::new(MockPtyProvider));

        // Create shutdown channel for tests
        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        let (tool_action_tx, _) = broadcast::channel(256);

        let state = AppState {
            sessions,
            mock_provider,
            shutdown_tx,
            start_time: Instant::now(),
            sessions_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            messages_processed_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            session_name_counter: Arc::new(std::sync::atomic::AtomicU64::new(1)),
            audit_logger: None,
            tool_action_tx,
        };

        let (_, rx) = mpsc::channel(32);
        (state, rx)
    }

    #[tokio::test]
    async fn test_create_session() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        if let Some(ServerMessage::SessionList { sessions }) = rx.recv().await {
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].shell, "/bin/bash");

            // Verify session is in state
            let guard = state.sessions.lock();
            assert!(guard.contains_key(&sessions[0].id));
        } else {
            panic!("Expected SessionList");
        }
    }

    #[tokio::test]
    async fn test_create_session_with_bogus_container_id_fails_and_rolls_back_counter() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let counter_before = state
            .session_name_counter
            .load(std::sync::atomic::Ordering::Relaxed);

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: Some("does-not-exist-xyz-12345".to_string()),
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Expect an Error response (not a SessionList)
        match rx.recv().await {
            Some(ServerMessage::Error {
                message,
                error_code,
            }) => {
                assert!(
                    message.contains("not found")
                        || message.contains("not running")
                        || message.contains("Docker"),
                    "unexpected error message: {}",
                    message
                );
                assert_eq!(error_code.as_deref(), Some("SESSION_ERROR"));
            }
            other => panic!("Expected Error, got {:?}", other),
        }

        // Counter should be rolled back to its pre-attempt value
        let counter_after = state
            .session_name_counter
            .load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            counter_before, counter_after,
            "session_name_counter should be rolled back on failure"
        );

        // No session should be in the map
        let guard = state.sessions.lock();
        assert!(guard.is_empty(), "failed session should not be in the map");
    }

    #[tokio::test]
    async fn test_create_session_with_bogus_ssh_connection_fails_and_rolls_back_counter() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let counter_before = state
            .session_name_counter
            .load(std::sync::atomic::Ordering::Relaxed);

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: Some("bogus-uuid-xyz-12345".to_string()),
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Expect an Error response
        match rx.recv().await {
            Some(ServerMessage::Error {
                message,
                error_code,
            }) => {
                assert!(
                    message.contains("not found"),
                    "unexpected error message: {}",
                    message
                );
                assert_eq!(error_code.as_deref(), Some("SESSION_ERROR"));
            }
            other => panic!("Expected Error, got {:?}", other),
        }

        // Counter should be rolled back
        let counter_after = state
            .session_name_counter
            .load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            counter_before, counter_after,
            "session_name_counter should be rolled back on failure"
        );
    }

    #[tokio::test]
    async fn test_rename_session() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // Rename
        let rename_msg = ClientMessage::RenameSession {
            session_id: id.clone(),
            new_name: "Production".to_string(),
        };
        process_message(
            &rename_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions[0].name, "Production");
            }
            _ => panic!("Expected SessionList update"),
        }
    }

    #[tokio::test]
    async fn test_kill_session() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // Kill
        let kill_msg = ClientMessage::KillSession {
            session_id: id.clone(),
        };
        process_message(
            &kill_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Should receive SessionClosed
        match rx.recv().await.unwrap() {
            ServerMessage::SessionClosed { session_id } => assert_eq!(session_id, id),
            _ => panic!("Expected SessionClosed"),
        }

        // Should receive updated SessionList (empty)
        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => assert_eq!(sessions.len(), 0),
            _ => panic!("Expected SessionList update"),
        }
    }

    #[tokio::test]
    async fn test_list_sessions() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        process_message(
            &ClientMessage::ListSessions,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => assert_eq!(sessions.len(), 0),
            _ => panic!("Expected empty SessionList"),
        }
    }

    #[tokio::test]
    async fn test_input_echo() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // Attach to receive echo
        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(
            &attach_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Initial Output (history - empty)
        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert_eq!(data, "");
            }
            _ => panic!("Expected initial Output"),
        }

        // Input
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "hello".to_string(),
        };
        process_message(
            &input_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Should receive echo
        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert_eq!(data, "hello");
            }
            _ => panic!("Expected echo Output"),
        }
    }

    #[tokio::test]
    async fn test_history_replay() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // Send input (MockPty echoes)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "HistoryTest".to_string(),
        };
        process_message(
            &input_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Give thread time to read and update history
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Attach - Should receive history
        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(
            &attach_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert!(data.contains("HistoryTest"));
            }
            _ => panic!("Expected history Output"),
        }
    }

    #[tokio::test]
    async fn test_reattach_cancels_previous_forwarder() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks: HashMap<String, tokio::task::JoinHandle<()>> = HashMap::new();

        // Create session
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // First attach
        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(
            &attach_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        // Drain history output
        rx.recv().await.unwrap();

        // Second attach (should cancel the first forwarder)
        process_message(
            &attach_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        // Drain history output
        rx.recv().await.unwrap();

        // Send input - should only produce ONE output (not duplicated)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test".to_string(),
        };
        process_message(
            &input_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        // Should receive exactly one output
        match rx.recv().await.unwrap() {
            ServerMessage::Output { data, .. } => assert_eq!(data, "test"),
            other => panic!("Expected Output, got {:?}", other),
        }

        // Give a moment for any duplicate to arrive
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Channel should be empty (no duplicate)
        assert!(
            rx.try_recv().is_err(),
            "Received duplicate output - old forwarder was not cancelled"
        );
    }

    #[tokio::test]
    async fn test_handle_connection_length_prefixed_framing() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (state, _) = create_test_state();
        let (mut client_io, server_io) = tokio::io::duplex(1024);

        tokio::spawn(async move {
            handle_connection(server_io, state.sessions.clone(), state.clone())
                .await
                .unwrap();
        });

        // Send a length-prefixed frame
        let cmd = ClientMessage::ListSessions;
        let json = serde_json::to_string(&cmd).unwrap();
        let json_bytes = json.as_bytes();
        let len = json_bytes.len() as u32;

        // Write length prefix (4 bytes big-endian)
        client_io.write_all(&len.to_be_bytes()).await.unwrap();
        // Write JSON payload
        client_io.write_all(json_bytes).await.unwrap();

        // Read response (length-prefixed)
        let mut len_buf = [0u8; 4];
        client_io.read_exact(&mut len_buf).await.unwrap();
        let resp_len = u32::from_be_bytes(len_buf) as usize;

        let mut resp_buf = vec![0u8; resp_len];
        client_io.read_exact(&mut resp_buf).await.unwrap();

        let response = String::from_utf8_lossy(&resp_buf);
        assert!(response.contains("SessionList"));
    }

    #[tokio::test]
    async fn test_unknown_session_cmds_return_errors() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Input to unknown - should get error
        process_message(
            &ClientMessage::Input {
                session_id: "bad".into(),
                data: "x".into(),
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not found"),
                    "Expected 'not found', got: {}",
                    message
                );
            }
            other => panic!(
                "Expected Error for input to unknown session, got {:?}",
                other
            ),
        }

        // Resize unknown - should get error
        process_message(
            &ClientMessage::Resize {
                session_id: "bad".into(),
                cols: 10,
                rows: 10,
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not found"),
                    "Expected 'not found', got: {}",
                    message
                );
            }
            other => panic!(
                "Expected Error for resize of unknown session, got {:?}",
                other
            ),
        }

        // Attach unknown - silent (no data to send)
        process_message(
            &ClientMessage::Attach {
                session_id: "bad".into(),
                mode: "rw".into(),
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        assert!(rx.try_recv().is_err());
    }

    // ==================== Task 3.4.2: Write Error Handling Tests ====================

    #[tokio::test]
    async fn test_input_to_nonexistent_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        process_message(
            &ClientMessage::Input {
                session_id: "nonexistent".into(),
                data: "hello".into(),
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not found") || message.contains("nonexistent"),
                    "Error should indicate session not found, got: {}",
                    message
                );
            }
            other => panic!("Expected Error message, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_input_to_errored_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create session
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Manually transition session to Error state
        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Error).unwrap();
            }
        }

        // Try to send input to errored session
        process_message(
            &ClientMessage::Input {
                session_id: id.clone(),
                data: "hello".into(),
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("error") || message.contains("not accepting"),
                    "Error should indicate session not accepting input, got: {}",
                    message
                );
            }
            other => panic!(
                "Expected Error message for errored session, got {:?}",
                other
            ),
        }
    }

    #[tokio::test]
    async fn test_resize_nonexistent_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        process_message(
            &ClientMessage::Resize {
                session_id: "nonexistent".into(),
                cols: 80,
                rows: 24,
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not found") || message.contains("nonexistent"),
                    "Error should indicate session not found, got: {}",
                    message
                );
            }
            other => panic!("Expected Error message, got {:?}", other),
        }
    }

    // Shell whitelist tests

    #[tokio::test]
    async fn test_shell_whitelist_allows_bin_bash() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].shell, "/bin/bash");
            }
            ServerMessage::Error { message, .. } => {
                panic!("Expected SessionList but got Error: {}", message)
            }
            other => panic!("Expected SessionList but got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_shell_whitelist_allows_bin_sh() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/sh".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].shell, "/bin/sh");
            }
            ServerMessage::Error { message, .. } => {
                panic!("Expected SessionList but got Error: {}", message)
            }
            other => panic!("Expected SessionList but got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_shell_whitelist_rejects_non_whitelisted() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/usr/bin/evil".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not allowed")
                        || message.contains("whitelist")
                        || message.contains("invalid"),
                    "Error message should indicate shell is not allowed: {}",
                    message
                );
            }
            ServerMessage::SessionList { .. } => {
                panic!("Expected Error but got SessionList - non-whitelisted shell was allowed!")
            }
            other => panic!("Expected Error but got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_shell_whitelist_rejects_path_traversal() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/../bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not allowed")
                        || message.contains("traversal")
                        || message.contains("invalid"),
                    "Error message should indicate path traversal is not allowed: {}",
                    message
                );
            }
            ServerMessage::SessionList { .. } => {
                panic!("Expected Error but got SessionList - path traversal was allowed!")
            }
            other => panic!("Expected Error but got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_shell_whitelist_rejects_relative_paths() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not allowed")
                        || message.contains("whitelist")
                        || message.contains("absolute"),
                    "Error message should indicate relative path is not allowed: {}",
                    message
                );
            }
            ServerMessage::SessionList { .. } => {
                panic!("Expected Error but got SessionList - relative path was allowed!")
            }
            other => panic!("Expected Error but got {:?}", other),
        }
    }

    // Environment variable blocklist tests

    #[test]
    fn test_filter_env_blocks_ld_preload() {
        let mut env = HashMap::new();
        env.insert("LD_PRELOAD".to_string(), "/evil/lib.so".to_string());
        env.insert("PATH".to_string(), "/usr/bin".to_string());
        env.insert("HOME".to_string(), "/home/user".to_string());

        let filtered = filter_env(&env);

        assert!(
            !filtered.contains_key("LD_PRELOAD"),
            "LD_PRELOAD should be filtered out"
        );
        assert!(filtered.contains_key("PATH"), "PATH should be allowed");
        assert!(filtered.contains_key("HOME"), "HOME should be allowed");
    }

    #[test]
    fn test_filter_env_blocks_dyld_vars() {
        let mut env = HashMap::new();
        env.insert(
            "DYLD_INSERT_LIBRARIES".to_string(),
            "/evil.dylib".to_string(),
        );
        env.insert("DYLD_FORCE_FLAT_NAMESPACE".to_string(), "1".to_string());
        env.insert("DYLD_LIBRARY_PATH".to_string(), "/evil".to_string());
        env.insert("DYLD_FRAMEWORK_PATH".to_string(), "/evil".to_string());
        env.insert("TERM".to_string(), "xterm-256color".to_string());

        let filtered = filter_env(&env);

        assert!(!filtered.contains_key("DYLD_INSERT_LIBRARIES"));
        assert!(!filtered.contains_key("DYLD_FORCE_FLAT_NAMESPACE"));
        assert!(!filtered.contains_key("DYLD_LIBRARY_PATH"));
        assert!(!filtered.contains_key("DYLD_FRAMEWORK_PATH"));
        assert!(filtered.contains_key("TERM"), "TERM should be allowed");
    }

    #[test]
    fn test_filter_env_preserves_safe_vars() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), "/usr/bin:/bin".to_string());
        env.insert("HOME".to_string(), "/home/user".to_string());
        env.insert("SHELL".to_string(), "/bin/bash".to_string());
        env.insert("USER".to_string(), "testuser".to_string());
        env.insert("TERM".to_string(), "xterm".to_string());

        let filtered = filter_env(&env);

        assert_eq!(filtered.len(), 5, "All safe vars should be preserved");
        assert_eq!(filtered.get("PATH").unwrap(), "/usr/bin:/bin");
        assert_eq!(filtered.get("HOME").unwrap(), "/home/user");
    }

    #[test]
    fn test_filter_env_case_sensitive() {
        let mut env = HashMap::new();
        env.insert("ld_preload".to_string(), "something".to_string());
        env.insert("LD_PRELOAD".to_string(), "evil".to_string());

        let filtered = filter_env(&env);

        assert!(
            filtered.contains_key("ld_preload"),
            "lowercase should be allowed (case-sensitive)"
        );
        assert!(
            !filtered.contains_key("LD_PRELOAD"),
            "uppercase should be blocked"
        );
    }

    // Dimension validation tests

    #[test]
    fn test_clamp_dimension_normal_values() {
        assert_eq!(clamp_dimension(80, "cols"), 80);
        assert_eq!(clamp_dimension(24, "rows"), 24);
        assert_eq!(clamp_dimension(1, "cols"), 1);
        assert_eq!(clamp_dimension(500, "rows"), 500);
    }

    #[test]
    fn test_clamp_dimension_below_minimum() {
        assert_eq!(clamp_dimension(0, "cols"), 1, "0 should clamp to 1");
    }

    #[test]
    fn test_clamp_dimension_above_maximum() {
        assert_eq!(clamp_dimension(501, "cols"), 500, "501 should clamp to 500");
        assert_eq!(
            clamp_dimension(1000, "rows"),
            500,
            "1000 should clamp to 500"
        );
        assert_eq!(
            clamp_dimension(u16::MAX, "cols"),
            500,
            "max u16 should clamp to 500"
        );
    }

    // PTY buffer size constant tests

    #[test]
    fn test_pty_read_buffer_size_constant_is_16384() {
        assert_eq!(
            PTY_READ_BUFFER_SIZE, 16384,
            "PTY_READ_BUFFER_SIZE should be 16384 bytes (16KB)"
        );
    }

    // Panic handling tests

    #[test]
    fn test_catch_unwind_extracts_string_panic_message() {
        let result = std::panic::catch_unwind(|| {
            panic!("test panic message");
        });

        if let Err(panic_info) = result {
            let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic".to_string()
            };
            assert_eq!(panic_msg, "test panic message");
        } else {
            panic!("Expected panic to be caught");
        }
    }

    #[test]
    fn test_catch_unwind_handles_unknown_panic_type() {
        let result = std::panic::catch_unwind(|| {
            std::panic::panic_any(42i32);
        });

        if let Err(panic_info) = result {
            let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic".to_string()
            };
            assert_eq!(panic_msg, "Unknown panic");
        } else {
            panic!("Expected panic to be caught");
        }
    }

    // Graceful shutdown tests

    #[test]
    fn test_app_state_has_shutdown_channel() {
        let (state, _) = create_test_state();
        let _rx = state.shutdown_tx.subscribe();
    }

    #[tokio::test]
    async fn test_shutdown_channel_broadcasts_to_subscribers() {
        let (state, _) = create_test_state();
        let mut rx1 = state.shutdown_tx.subscribe();
        let mut rx2 = state.shutdown_tx.subscribe();

        let _ = state.shutdown_tx.send(());

        assert!(
            rx1.recv().await.is_ok(),
            "First subscriber should receive shutdown"
        );
        assert!(
            rx2.recv().await.is_ok(),
            "Second subscriber should receive shutdown"
        );
    }

    #[tokio::test]
    async fn test_shutdown_signal_stops_message_processing() {
        let (state, _) = create_test_state();
        let mut rx = state.shutdown_tx.subscribe();

        let task = tokio::spawn(async move { rx.recv().await.is_ok() });

        tokio::time::sleep(Duration::from_millis(10)).await;

        let _ = state.shutdown_tx.send(());

        let result = tokio::time::timeout(Duration::from_secs(1), task).await;
        assert!(result.is_ok(), "Task should complete after shutdown signal");
        assert!(
            result.unwrap().unwrap(),
            "Task should have received shutdown signal"
        );
    }

    #[test]
    fn test_shutdown_message_type_exists() {
        let msg = ServerMessage::Shutdown {
            reason: "Test shutdown".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("Shutdown"));
        assert!(json.contains("Test shutdown"));
    }

    #[tokio::test]
    async fn test_session_cleanup_on_drop() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        let session_id = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions[0].id.clone(),
            _ => panic!("Expected SessionList"),
        };

        assert_eq!(state.sessions.lock().len(), 1);

        {
            let mut guard = state.sessions.lock();
            let session = guard.remove(&session_id);
            assert!(session.is_some(), "Session should exist before removal");
        }

        assert_eq!(state.sessions.lock().len(), 0);
    }

    #[test]
    fn test_shutdown_timeout_constant_is_defined() {
        assert_eq!(
            SHUTDOWN_TIMEOUT_SECS, 5,
            "Shutdown timeout should be 5 seconds"
        );
    }

    // === Working Directory Validation ===

    #[tokio::test]
    async fn test_cwd_rejects_path_traversal() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/tmp/../etc/passwd".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("traversal") || message.contains(".."),
                    "Error should mention path traversal, got: {}",
                    message
                );
            }
            other => panic!("Expected Error for path traversal in cwd, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_cwd_rejects_nonexistent_path() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/nonexistent/path/that/does/not/exist".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("does not exist")
                        || message.contains("not found")
                        || message.contains("invalid"),
                    "Error should indicate path doesn't exist, got: {}",
                    message
                );
            }
            other => panic!("Expected Error for nonexistent cwd, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_cwd_accepts_valid_path() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };

        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].cwd, "/tmp");
            }
            ServerMessage::Error { message, .. } => {
                panic!("Expected SessionList but got Error: {}", message)
            }
            other => panic!("Expected SessionList, got {:?}", other),
        }
    }

    // === Enhanced Metrics ===

    #[tokio::test]
    async fn test_messages_processed_total_increments() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        assert_eq!(
            state
                .messages_processed_total
                .load(std::sync::atomic::Ordering::Relaxed),
            0,
        );

        process_message(
            &ClientMessage::ListSessions,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let _ = rx.recv().await;

        assert_eq!(
            state
                .messages_processed_total
                .load(std::sync::atomic::Ordering::Relaxed),
            1,
        );

        process_message(
            &ClientMessage::ListSessions,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let _ = rx.recv().await;

        assert_eq!(
            state
                .messages_processed_total
                .load(std::sync::atomic::Ordering::Relaxed),
            2,
        );
    }

    #[tokio::test]
    async fn test_sessions_total_counter_increments_on_create() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        assert_eq!(
            state
                .sessions_total
                .load(std::sync::atomic::Ordering::Relaxed),
            0,
        );

        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let _ = rx.recv().await;

        assert_eq!(
            state
                .sessions_total
                .load(std::sync::atomic::Ordering::Relaxed),
            1,
        );
    }

    // === Exited Session State Integration Tests ===

    #[tokio::test]
    async fn test_input_to_exited_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Exited).unwrap();
            }
        }

        process_message(
            &ClientMessage::Input {
                session_id: id.clone(),
                data: "hello".into(),
            },
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(
                    message.contains("not accepting"),
                    "Error should indicate session not accepting input, got: {}",
                    message
                );
            }
            other => panic!("Expected Error message for exited session, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_exited_session_allows_attach() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test_data".to_string(),
        };
        process_message(
            &input_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;

        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Exited).unwrap();
            }
        }

        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(
            &attach_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert!(data.contains("test_data"), "Should contain history data");
            }
            other => panic!(
                "Expected Output with history for exited session, got {:?}",
                other
            ),
        }
    }

    // === Activity Tracking Integration Tests ===

    #[tokio::test]
    async fn test_activity_tracking_updates_last_output_at() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(
                session.last_output_at.lock().is_none(),
                "last_output_at should be None before any output"
            );
        }

        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "hello".to_string(),
        };
        process_message(
            &input_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        tokio::time::sleep(Duration::from_millis(200)).await;

        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(
                session.last_output_at.lock().is_some(),
                "last_output_at should be set after output"
            );
        }
    }

    #[tokio::test]
    async fn test_bell_detection_updates_last_bell_at() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            container_id: None,
            ssh_connection_id: None,
        };
        process_message(
            &create_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Send BEL character (0x07) - MockPty echoes it, reader thread detects bell
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "\x07".to_string(),
        };
        process_message(
            &input_msg,
            &tx,
            &state.sessions,
            &state,
            &mut attach_tasks,
            "test",
        )
        .await
        .unwrap();

        tokio::time::sleep(Duration::from_millis(200)).await;

        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(
                session.last_bell_at.lock().is_some(),
                "last_bell_at should be set after BEL character"
            );
        }
    }
}
