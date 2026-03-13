//! terminar Server library.
//!
//! This crate implements the backend for the terminar terminal multiplexer.
//! It manages terminal sessions via PTY processes, exposes them over Unix sockets
//! (for local VS Code communication), and supports session persistence, history
//! compression, and graceful shutdown.

pub mod config;
pub mod constants;
pub mod error;
pub mod handlers;
pub mod history;
pub mod logging;
pub mod messages;
pub mod persistence;
pub mod process;
pub mod pty;
pub mod session;
pub mod settings;
pub mod workspace;

use config::Cli;
use messages::{ClientMessage, ServerMessage};
use pty::MockPtyProvider;
use session::SessionMap;

use parking_lot::Mutex; // Non-poisoning mutex - doesn't require unwrap()
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
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

/// Shared application state passed to all connection handlers.
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
    /// Server start time, used for uptime calculation in metrics.
    pub start_time: Instant,
    /// Monotonically increasing counter of total sessions created since server start.
    pub sessions_total: Arc<std::sync::atomic::AtomicU64>,
    /// Monotonically increasing counter of total protocol messages processed.
    pub messages_processed_total: Arc<std::sync::atomic::AtomicU64>,
    /// Monotonically increasing counter for auto-naming sessions ("Terminal 1", "Terminal 2", etc.).
    pub session_name_counter: Arc<std::sync::atomic::AtomicU64>,
}

/// Starts the terminar server with a Unix socket listener.
///
/// This is the main entry point for the server. It initializes logging, loads
/// persisted sessions, starts the Unix socket listener, and waits for
/// SIGTERM/SIGINT for graceful shutdown.
pub async fn run_server(cli: Cli, socket_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging with CLI-configured options
    let _log_guard = logging::init_logging(&cli);

    let start_time = Instant::now();
    info!("Starting terminar Server...");

    let sessions: SessionMap = Arc::new(Mutex::new(HashMap::new()));

    // Restore persisted sessions on startup.
    let mut initial_name_counter: u64 = 1;
    let session_file = persistence::get_session_file_path();
    let history_dir = persistence::get_history_dir();
    let history_dir_str = history_dir.to_string_lossy().to_string();
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

                    // Load history for this session
                    let history_data = match persistence::load_history_auto(&history_dir_str, &s.id)
                    {
                        Ok(Some(data)) => {
                            info!(
                                "Loaded {} bytes of history for session {}",
                                data.len(),
                                s.id
                            );
                            Some(data)
                        }
                        Ok(None) => {
                            info!("No history file for session {}", s.id);
                            None
                        }
                        Err(e) => {
                            warn!("Failed to load history for session {}: {}", s.id, e);
                            None
                        }
                    };

                    // Validate shell and cwd before restoring
                    let shell = handlers::session::resolve_shell(&s.shell_cmd);
                    let cwd_candidate = handlers::session::resolve_cwd(&s.cwd);
                    if handlers::session::validate_shell(&shell).is_some() {
                        warn!(
                            "Skipping restore of session {} with invalid shell: {}",
                            s.id, shell
                        );
                        continue;
                    }
                    if handlers::session::validate_cwd(&cwd_candidate).is_some() {
                        warn!(
                            "Skipping restore of session {} with invalid cwd: {} (using home dir)",
                            s.id, s.cwd
                        );
                        // Fall through with home dir
                    }

                    match handlers::session::create_session_core(
                        Some(&s.id),
                        &s.name,
                        &shell,
                        &cwd_candidate,
                        80,
                        24,
                        &HashMap::new(),
                        &sessions,
                        cli.mock_pty.then(|| Arc::new(MockPtyProvider)).as_ref(),
                        history_data.as_deref(),
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

    let state = AppState {
        sessions: sessions.clone(),
        mock_provider,
        shutdown_tx: shutdown_tx.clone(),
        start_time: Instant::now(),
        sessions_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        messages_processed_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        session_name_counter: Arc::new(std::sync::atomic::AtomicU64::new(initial_name_counter)),
    };

    // Stdio transport mode: read/write length-prefixed JSON on stdin/stdout
    if cli.stdio {
        return run_stdio_server(state).await;
    }

    // Start Unix Socket Server
    let socket_path_owned = socket_path.to_string();
    if std::path::Path::new(socket_path).exists() {
        std::fs::remove_file(socket_path)?;
    }
    let listener_unix = UnixListener::bind(socket_path)?;
    info!("Unix Socket listening on {}", socket_path);

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

    // Start foreground process polling task
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

    // Start silence checker task
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

    // Start periodic session persistence task
    let persist_sessions = sessions.clone();
    let mut persist_shutdown_rx = shutdown_tx.subscribe();
    let _persist_task = tokio::spawn(async move {
        let save_interval = Duration::from_secs(constants::PERIODIC_SAVE_INTERVAL_SECS);
        loop {
            tokio::select! {
                _ = tokio::time::sleep(save_interval) => {
                    persistence::persist_all(&persist_sessions);
                }
                _ = persist_shutdown_rx.recv() => {
                    info!("Periodic persistence task received shutdown signal");
                    break;
                }
            }
        }
    });

    // Wait for shutdown signal (SIGTERM or SIGINT)
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
        unix_task.abort();

        // Wait a moment for in-flight messages
        tokio::time::sleep(Duration::from_millis(100)).await;
    })
    .await;

    if shutdown_result.is_err() {
        warn!("Shutdown timeout reached, forcing cleanup");
    }

    // Save session histories and metadata before cleanup
    info!("Saving session histories and metadata...");
    persistence::persist_all(&sessions);

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

/// Combines a reader and writer into a single `AsyncRead + AsyncWrite` stream.
///
/// Used by stdio transport to pass tokio stdin/stdout as a single stream
/// to `handle_connection`, which calls `tokio::io::split()` internally.
struct CombinedStream<R, W> {
    reader: R,
    writer: W,
}

impl<R, W> AsyncRead for CombinedStream<R, W>
where
    R: AsyncRead + Unpin,
    W: Unpin,
{
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().reader).poll_read(cx, buf)
    }
}

impl<R, W> AsyncWrite for CombinedStream<R, W>
where
    R: Unpin,
    W: AsyncWrite + Unpin,
{
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().writer).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().writer).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().writer).poll_shutdown(cx)
    }
}

/// Runs the server in stdio mode, reading/writing length-prefixed JSON on stdin/stdout.
///
/// This mode is used for Windows/WSL support where the Electron app spawns
/// `wsl.exe terminar-server --stdio` and communicates via stdin/stdout pipes.
///
/// The framing format is identical to Unix socket connections: 4-byte big-endian
/// length prefix followed by a JSON payload.
async fn run_stdio_server(state: AppState) -> Result<(), Box<dyn std::error::Error>> {
    info!("Running in stdio mode (stdin/stdout transport)");

    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let stream = CombinedStream {
        reader: stdin,
        writer: stdout,
    };

    handle_connection(stream, state.sessions.clone(), state).await
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
        } => {
            handlers::session::handle_create_session(
                cwd, shell, env, *cols, *rows, tx_out, sessions, state,
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
            handlers::io::handle_attach(session_id, tx_out, sessions, attach_tasks).await?;
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
        ClientMessage::SaveWorkspace { workspace } => {
            handlers::workspace::handle_save_workspace(client_id, workspace, tx_out).await?;
        }
        ClientMessage::LoadWorkspace => {
            handlers::workspace::handle_load_workspace(client_id, tx_out).await?;
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

        let state = AppState {
            sessions,
            mock_provider,
            shutdown_tx,
            start_time: Instant::now(),
            sessions_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            messages_processed_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            session_name_counter: Arc::new(std::sync::atomic::AtomicU64::new(1)),
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

    // ==================== Write Error Handling Tests ====================

    #[tokio::test]
    async fn test_input_to_nonexistent_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Input to a session that doesn't exist
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

        // Should receive an Error message about session not found
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

        // Should receive an Error message about session state
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

        // Resize a session that doesn't exist
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

        // Should receive an Error message
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

        // Should receive SessionList (success), not Error
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
            shell: "bash".to_string(), // Relative path - should be rejected
            env: HashMap::new(),
            cols: 80,
            rows: 24,
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
        // lowercase - should NOT be blocked (case-sensitive)
        env.insert("ld_preload".to_string(), "something".to_string());
        env.insert("LD_PRELOAD".to_string(), "evil".to_string());

        let filtered = filter_env(&env);

        // Only the exact case LD_PRELOAD should be blocked
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
        let panic_info = std::panic::catch_unwind(|| {
            panic!("test panic message");
        })
        .expect_err("Expected panic to be caught");

        let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };
        assert_eq!(panic_msg, "test panic message");
    }

    #[test]
    fn test_catch_unwind_handles_unknown_panic_type() {
        let panic_info = std::panic::catch_unwind(|| {
            std::panic::panic_any(42i32);
        })
        .expect_err("Expected panic to be caught");

        let panic_msg = if let Some(s) = panic_info.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };
        assert_eq!(panic_msg, "Unknown panic");
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

        // Create a session
        let msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
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

        // Get session ID
        let session_id = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions[0].id.clone(),
            _ => panic!("Expected SessionList"),
        };

        // Verify session exists
        assert_eq!(state.sessions.lock().len(), 1);

        // Remove session (simulating shutdown cleanup)
        {
            let mut guard = state.sessions.lock();
            let session = guard.remove(&session_id);
            assert!(session.is_some(), "Session should exist before removal");
        } // Session dropped here

        // Session should be gone
        assert_eq!(state.sessions.lock().len(), 0);
    }

    #[test]
    fn test_shutdown_timeout_constant_is_defined() {
        assert_eq!(
            SHUTDOWN_TIMEOUT_SECS, 5,
            "Shutdown timeout should be 5 seconds"
        );
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
            "messages_processed_total should start at 0"
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
            "messages_processed_total should be 1 after one message"
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
            "messages_processed_total should be 2 after two messages"
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
            "sessions_total should start at 0"
        );

        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
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
            "sessions_total should be 1 after creating one session"
        );
    }

    #[tokio::test]
    async fn test_sessions_active_gauge_reflects_current_sessions() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        assert_eq!(
            state.sessions.lock().len(),
            0,
            "sessions_active should be 0 initially"
        );

        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
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
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        assert_eq!(
            state.sessions.lock().len(),
            1,
            "sessions_active should be 1 after create"
        );

        let kill_msg = ClientMessage::KillSession { session_id: id };
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
        let _ = rx.recv().await; // SessionClosed
        let _ = rx.recv().await; // SessionList

        assert_eq!(
            state.sessions.lock().len(),
            0,
            "sessions_active should be 0 after kill"
        );
    }

    #[tokio::test]
    async fn test_history_bytes_gauge_per_session() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
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
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // Verify history buffer starts empty
        let history_len = {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            session.history.lock().len()
        };
        assert_eq!(history_len, 0, "History should start empty");
    }

    // Working directory validation tests

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

    // === Stdio transport tests ===

    #[tokio::test]
    async fn test_stdio_read_length_prefixed_message() {
        // Simulate a client writing a length-prefixed message to the server via stdio
        let (mut client_io, server_io) = tokio::io::duplex(4096);
        let (state, _) = create_test_state();

        tokio::spawn(async move {
            handle_connection(server_io, state.sessions.clone(), state.clone())
                .await
                .unwrap();
        });

        // Write a ListSessions message with length-prefix framing
        let msg = ClientMessage::ListSessions;
        let json = serde_json::to_string(&msg).unwrap();
        let json_bytes = json.as_bytes();
        let len = json_bytes.len() as u32;

        client_io.write_all(&len.to_be_bytes()).await.unwrap();
        client_io.write_all(json_bytes).await.unwrap();

        // Read the response
        let mut len_buf = [0u8; 4];
        client_io.read_exact(&mut len_buf).await.unwrap();
        let resp_len = u32::from_be_bytes(len_buf) as usize;
        assert!(resp_len > 0, "Response should have non-zero length");

        let mut resp_buf = vec![0u8; resp_len];
        client_io.read_exact(&mut resp_buf).await.unwrap();

        let response: ServerMessage = serde_json::from_slice(&resp_buf).unwrap();
        match response {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 0, "Should have empty session list");
            }
            other => panic!("Expected SessionList, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_stdio_write_length_prefixed_response() {
        // Verify responses are correctly length-prefixed
        let (mut client_io, server_io) = tokio::io::duplex(4096);
        let (state, _) = create_test_state();

        tokio::spawn(async move {
            handle_connection(server_io, state.sessions.clone(), state.clone())
                .await
                .unwrap();
        });

        // Send two messages and verify both responses are correctly framed
        for _ in 0..2 {
            let msg = ClientMessage::ListSessions;
            let json = serde_json::to_string(&msg).unwrap();
            let json_bytes = json.as_bytes();
            let len = json_bytes.len() as u32;

            client_io.write_all(&len.to_be_bytes()).await.unwrap();
            client_io.write_all(json_bytes).await.unwrap();

            // Read length prefix
            let mut len_buf = [0u8; 4];
            client_io.read_exact(&mut len_buf).await.unwrap();
            let resp_len = u32::from_be_bytes(len_buf) as usize;

            // Read exactly that many bytes of JSON
            let mut resp_buf = vec![0u8; resp_len];
            client_io.read_exact(&mut resp_buf).await.unwrap();

            // Must parse as valid JSON ServerMessage
            let response: ServerMessage = serde_json::from_slice(&resp_buf).unwrap();
            assert!(
                matches!(response, ServerMessage::SessionList { .. }),
                "Expected SessionList"
            );
        }
    }

    #[tokio::test]
    async fn test_stdio_eof_handling() {
        // When stdin reaches EOF, handle_connection should exit gracefully (not panic)
        let (client_io, server_io) = tokio::io::duplex(4096);
        let (state, _) = create_test_state();

        // Drop the client side to signal EOF before starting
        drop(client_io);

        // handle_connection should return Ok(()) on EOF
        let result = handle_connection(server_io, state.sessions.clone(), state.clone()).await;
        assert!(result.is_ok(), "handle_connection should return Ok on EOF");
    }

    #[tokio::test]
    async fn test_stdio_combined_stream_works_bidirectionally() {
        // Test that CombinedStream correctly routes reads and writes
        let (client_io, server_io) = tokio::io::duplex(4096);
        let (reader, writer) = tokio::io::split(client_io);

        // Create a CombinedStream from the split halves
        // (simulates what run_stdio_server does with stdin/stdout)
        let mut stream = CombinedStream {
            reader,
            writer,
        };

        let (mut other_side_r, mut other_side_w) = tokio::io::split(server_io);

        // Write from "other side" and read via CombinedStream
        let write_handle = tokio::spawn(async move {
            other_side_w.write_all(b"hello").await.unwrap();
        });
        write_handle.await.unwrap();

        let mut buf = [0u8; 5];
        stream.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"hello");

        // Write via CombinedStream and read from "other side"
        stream.write_all(b"world").await.unwrap();

        let mut buf2 = [0u8; 5];
        other_side_r.read_exact(&mut buf2).await.unwrap();
        assert_eq!(&buf2, b"world");
    }
}
