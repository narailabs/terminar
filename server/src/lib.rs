//! termiNar Server library.
//!
//! This crate implements the backend for the termiNar VS Code extension.
//! It manages terminal sessions via PTY processes, exposes them over Unix sockets
//! (for local VS Code communication) and HTTP/WebSocket (for web frontends and
//! remote pairing), and supports session persistence, history compression, and
//! graceful shutdown.

pub mod audit;
pub mod auth;
pub mod config;
pub mod connection;
pub mod constants;
pub mod error;
pub mod gateway;
pub mod handlers;
pub mod history;
pub mod jwt;
pub mod logging;
pub mod messages;
pub mod persistence;
pub mod process;
pub mod pty;
pub mod revocation;
pub mod security_headers;
pub mod session;
pub mod settings;
pub mod tls;
pub mod workspace;

use messages::{ClientMessage, ServerMessage};
use session::SessionMap;
use config::Cli;
use pty::MockPtyProvider;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use parking_lot::Mutex;  // Non-poisoning mutex - doesn't require unwrap()
use tokio::io::{AsyncRead, AsyncWrite, AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;
use tracing::{info, error, warn, info_span, Instrument};
use std::time::{Instant, Duration};

use constants::{
    RATE_LIMIT_WINDOW_SECS, MAX_WS_AUTH_ATTEMPTS,
    DEFAULT_CORS_ORIGINS, SHUTDOWN_TIMEOUT_SECS,
};

// Re-export handler functions used by tests in this module
#[cfg(test)]
use handlers::session::{filter_env, clamp_dimension};
#[cfg(test)]
use session::SessionState;

use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State, Request, Json, ConnectInfo},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    routing::{get, post, put},
    middleware::{self, Next},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use axum::http::{header, Method};
use futures::{sink::SinkExt, stream::StreamExt};
use serde::{Deserialize, Serialize};

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
            // Use the output_tx broadcast channel - clients listening for session
            // events will receive this notification
            let _ = session.output_tx.send(session::SessionEvent::ForegroundChanged(new_process.clone()));
        }

        // Poll CWD of the foreground process
        let new_cwd = process::get_process_cwd(pty_fd);
        if let Some(ref cwd) = new_cwd {
            if *cwd != session.cwd {
                let old = session.cwd.clone();
                session.cwd = cwd.clone();
                tracing::debug!(
                    session_id = %session.id,
                    old_cwd = %old,
                    new_cwd = %cwd,
                    "CWD changed"
                );
                let _ = session.output_tx.send(session::SessionEvent::CwdChanged(cwd.clone()));
            }
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
        if session.silence_notified.load(std::sync::atomic::Ordering::Relaxed) {
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
            session.silence_notified.store(true, std::sync::atomic::Ordering::Relaxed);
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

/// Builds a router that redirects all HTTP requests to HTTPS.
///
/// The `/health` endpoint is still served over HTTP for load balancer checks.
/// All other requests get a 301 Permanent Redirect to the HTTPS equivalent.
fn build_http_redirect_router(tls_port: u16) -> Router {
    Router::new()
        .route("/health", get(|| async {
            Json(serde_json::json!({"status": "ok"}))
        }))
        .fallback(move |req: Request| async move {
            let host = req.headers()
                .get("host")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("localhost");
            // Strip existing port from host if present
            let hostname = host.split(':').next().unwrap_or(host);
            let uri = req.uri();
            let redirect_url = if tls_port == 443 {
                format!("https://{}{}", hostname, uri)
            } else {
                format!("https://{}:{}{}", hostname, tls_port, uri)
            };
            Redirect::permanent(&redirect_url)
        })
}

/// Creates a CORS layer based on CLI configuration
fn create_cors_layer(origins: &[String]) -> CorsLayer {
    if origins.is_empty() {
        // Use default localhost origins for development
        info!("Using default CORS origins for localhost");
        CorsLayer::new()
            .allow_origin(DEFAULT_CORS_ORIGINS.iter().map(|s| s.parse().unwrap()).collect::<Vec<_>>())
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
    } else {
        // Use provided origins
        info!("Using custom CORS origins: {:?}", origins);
        let parsed_origins: Vec<_> = origins.iter()
            .filter_map(|o| o.parse().ok())
            .collect();

        if parsed_origins.is_empty() {
            warn!("No valid CORS origins parsed, falling back to permissive");
            return CorsLayer::permissive();
        }

        CorsLayer::new()
            .allow_origin(parsed_origins)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
    }
}

/// Shared application state passed to all HTTP/WebSocket handlers.
///
/// This struct is cloned into each request handler via Axum's `State` extractor.
/// All mutable fields use `Arc` wrappers for safe concurrent access.
#[derive(Clone)]
pub struct AppState {
    /// Map of session ID to active `Session` objects.
    pub sessions: SessionMap,
    /// API key (UUID) generated on server startup for authenticating clients.
    pub api_key: String,
    /// Active pairing codes: code -> (token, creation_time). Codes expire after 5 minutes.
    pub pairing_codes: Arc<Mutex<HashMap<String, (String, Instant)>>>,
    /// Rate limiting for pairing attempts: IP address -> list of attempt timestamps.
    pub pairing_attempts: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
    /// When true, all authentication checks are bypassed (development only).
    pub no_auth: bool,
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
    /// Set of revoked API tokens that should be rejected on authentication.
    pub revoked_tokens: Arc<Mutex<HashSet<String>>>,
    /// JWT signing key for session tokens.
    pub signing_key: Arc<Vec<u8>>,
    /// Unique server identifier for JWT claims.
    pub server_id: String,
    /// Password verifier (PAM or mock). None if password auth is disabled.
    pub password_verifier: Option<Arc<dyn auth::PasswordVerifier>>,
    /// Maximum failed auth attempts per IP before hard lockout.
    pub max_auth_attempts: usize,
    /// Optional audit logger for security event tracking.
    pub audit_logger: Option<Arc<audit::AuditLogger>>,
    /// Trusted proxy IP — only trust X-Forwarded-For from this address.
    pub trusted_proxy: Option<String>,
    /// When true, require authentication even for local/loopback connections.
    pub require_auth: bool,
    /// Persistent token revocation store for refresh token rotation.
    pub revocation_store: Option<Arc<revocation::RevocationStore>>,
}

/// Request body for the `POST /pair/exchange` endpoint.
#[derive(Deserialize)]
pub struct ExchangeRequest {
    /// The 8-digit pairing code to exchange for an API token.
    pub code: String,
}

/// Response body for the `POST /pair/exchange` endpoint.
#[derive(Serialize)]
pub struct ExchangeResponse {
    /// The API token to use for subsequent authenticated requests.
    pub token: String,
}

/// Response body for the `GET /health` endpoint.
#[derive(Serialize)]
pub struct HealthResponse {
    /// Always `"ok"` when the server is running.
    pub status: String,
    /// Number of currently active terminal sessions.
    pub sessions: usize,
    /// Server version from `Cargo.toml`.
    pub version: String,
}

/// Response body for the `GET /metrics` endpoint in Prometheus exposition format.
#[derive(Serialize)]
pub struct MetricsResponse {
    /// Number of currently active terminal sessions.
    pub sessions_active: usize,
    /// Total sessions created since server start (monotonically increasing).
    pub sessions_total_created: u64,
    /// Total protocol messages processed since server start.
    pub messages_processed_total: u64,
    /// Server uptime in seconds.
    pub uptime_seconds: u64,
}

/// Request body for the `POST /auth/revoke` endpoint.
#[derive(Deserialize)]
pub struct RevokeRequest {
    /// The token to revoke.
    pub token: String,
}

/// Response body for the `POST /auth/revoke` endpoint.
#[derive(Serialize)]
pub struct RevokeResponse {
    /// Always `"revoked"` on success.
    pub status: String,
}

/// Request body for the `POST /auth/refresh` endpoint.
#[derive(Deserialize)]
pub struct RefreshRequest {
    /// The refresh token to exchange for new tokens.
    pub refresh_token: String,
}

/// Response body for the `POST /auth/refresh` endpoint.
#[derive(Serialize)]
pub struct RefreshResponse {
    /// New short-lived access token.
    pub access_token: String,
    /// New refresh token (rotated).
    pub refresh_token: String,
    /// Access token expiry description.
    pub expires_in: String,
}

/// Validates a WebSocket origin header against the whitelist.
/// Returns true if the origin is allowed, false otherwise.
pub fn validate_websocket_origin(origin: Option<&str>, custom_origins: &[String]) -> bool {
    match origin {
        None => true, // No origin header = likely not a browser request, allow
        Some("") => false, // Empty origin is suspicious, reject
        Some(origin) => {
            // Check default origins
            if DEFAULT_CORS_ORIGINS.contains(&origin) {
                return true;
            }
            // Check custom origins
            if custom_origins.iter().any(|o| o == origin) {
                return true;
            }
            warn!("Rejected WebSocket connection from unknown origin: {}", origin);
            false
        }
    }
}

/// Returns true if the process is running as root (UID 0).
///
/// Used by `--user-mode` to refuse running as root as a safety measure.
/// Per-user servers should always run as the target user, never as root.
#[cfg(unix)]
pub fn is_running_as_root() -> bool {
    unsafe { libc::getuid() == 0 }
}

#[cfg(not(unix))]
pub fn is_running_as_root() -> bool {
    false
}

/// Connects to a running server via Unix socket and requests a pairing code.
///
/// This is used by the `pair` CLI subcommand. It sends a `PairRequest` message
/// to the server and prints the returned 8-digit code to stdout.
pub async fn handle_pair_command(socket_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut stream = UnixStream::connect(socket_path).await?;
    let msg = ClientMessage::PairRequest;
    let json = serde_json::to_string(&msg)? + "\n";
    stream.write_all(json.as_bytes()).await?;
    
    let mut buf = [0u8; 1024];
    let n = stream.read(&mut buf).await?;
    let resp: ServerMessage = serde_json::from_slice(&buf[0..n])?;
    
    if let ServerMessage::PairResponse { code, expiry_secs } = resp {
        println!("Pairing Code: {} (Valid for {} seconds)", code, expiry_secs);
    } else {
        error!("Unexpected response from server: {:?}", resp);
    }
    
    Ok(())
}

/// Returns the path to the token file (~/.terminar/token)
pub fn get_token_file_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home).join(".terminar").join("token")
}

/// Writes the API token to ~/.terminar/token with secure permissions (0600)
fn write_token_file(token: &str) -> std::io::Result<()> {
    use std::io::Write;

    let token_path = get_token_file_path();

    // Create directory if it doesn't exist
    if let Some(parent) = token_path.parent() {
        std::fs::create_dir_all(parent)?;
        // Set directory permissions to 0700 (owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        }
    }

    // Write token to file
    let mut file = std::fs::File::create(&token_path)?;
    file.write_all(token.as_bytes())?;

    // Set file permissions to 0600 (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&token_path, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

/// Starts the termiNar server with both HTTP/WebSocket and Unix socket listeners.
///
/// This is the main entry point for the server. It initializes logging, loads
/// persisted sessions, writes the API token file, starts both HTTP and Unix socket
/// listeners, and waits for SIGTERM/SIGINT for graceful shutdown.
pub async fn run_server(cli: Cli, socket_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    // User-mode safety check: refuse to run as root
    if cli.user_mode {
        if is_running_as_root() {
            return Err("Refusing to run in --user-mode as root. This is a safety check.".into());
        }
        info!("Running in user-mode (auth delegated to gateway)");
    }

    // Initialize logging with CLI-configured options (JSON, file, level)
    // The guard must be held for the lifetime of the server to flush file logs
    let _log_guard = logging::init_logging(&cli);

    let start_time = Instant::now();
    info!("Starting termiNar Server...");

    let sessions: SessionMap = Arc::new(Mutex::new(HashMap::new()));
    let api_key = Uuid::new_v4().to_string();

    // Restore persisted sessions on startup.
    // Load session metadata and history, then create new PTY sessions
    // with the original IDs and scrollback content.
    let mut initial_name_counter: u64 = 1;
    let session_file = persistence::get_session_file_path();
    let history_dir = persistence::get_history_dir();
    let history_dir_str = history_dir.to_string_lossy().to_string();
    match persistence::load_sessions(&session_file.to_string_lossy()) {
        Ok(data) => {
            let running_sessions: Vec<_> = data.sessions.iter()
                .filter(|s| s.state == "Running")
                .collect();
            if !running_sessions.is_empty() {
                info!("Restoring {} persisted session(s)...", running_sessions.len());
                for s in &running_sessions {
                    // Track "Terminal N" counter
                    if let Some(n) = s.name.strip_prefix("Terminal ") {
                        if let Ok(num) = n.parse::<u64>() {
                            if num >= initial_name_counter {
                                initial_name_counter = num + 1;
                            }
                        }
                    }

                    // Load history for this session
                    let history_data = match persistence::load_history_auto(&history_dir_str, &s.id) {
                        Ok(Some(data)) => {
                            info!("Loaded {} bytes of history for session {}", data.len(), s.id);
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
                        warn!("Skipping restore of session {} with invalid shell: {}", s.id, shell);
                        continue;
                    }
                    if handlers::session::validate_cwd(&cwd_candidate).is_some() {
                        warn!("Skipping restore of session {} with invalid cwd: {} (using home dir)", s.id, s.cwd);
                        // Fall through with home dir
                    }

                    match handlers::session::create_session_core(
                        Some(&s.id),
                        &s.name,
                        &shell,
                        &cwd_candidate,
                        80, 24,
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

    // Write token to file for automatic client authentication
    // In user-mode, skip token file writing (gateway handles auth)
    if !cli.user_mode {
        match write_token_file(&api_key) {
            Ok(()) => info!("Token written to {:?}", get_token_file_path()),
            Err(e) => warn!("Failed to write token file: {} (clients will need manual auth)", e),
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

    // Load or create JWT signing key
    let key_path = std::path::PathBuf::from(
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    ).join(".terminar").join("server.key");
    let signing_key = jwt::load_or_create_signing_key(&key_path)
        .unwrap_or_else(|e| {
            warn!("Failed to load/create signing key: {}, generating ephemeral key", e);
            jwt::generate_signing_key()
        });
    let server_id = uuid::Uuid::new_v4().to_string();

    // In user-mode, auth is delegated to the gateway — skip password verifier
    let skip_auth = cli.no_auth || cli.user_mode;

    // Create platform-specific password verifier (PAM on macOS/Linux, LogonUser on Windows)
    let password_verifier: Option<Arc<dyn auth::PasswordVerifier>> = if skip_auth {
        None
    } else {
        auth::create_platform_verifier("login").map(|v| Arc::from(v) as Arc<dyn auth::PasswordVerifier>)
    };

    let mut state = AppState {
        sessions: sessions.clone(),
        api_key,
        pairing_codes: Arc::new(Mutex::new(HashMap::new())),
        pairing_attempts: Arc::new(Mutex::new(HashMap::new())),
        no_auth: skip_auth,
        mock_provider,
        shutdown_tx: shutdown_tx.clone(),
        start_time: Instant::now(),
        sessions_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        messages_processed_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        session_name_counter: Arc::new(std::sync::atomic::AtomicU64::new(initial_name_counter)),
        revoked_tokens: Arc::new(Mutex::new(HashSet::new())),
        signing_key: Arc::new(signing_key),
        server_id,
        password_verifier,
        max_auth_attempts: cli.max_auth_attempts,
        trusted_proxy: cli.trusted_proxy.clone(),
        audit_logger: None, // Will be replaced after async init
        require_auth: cli.require_auth,
        revocation_store: None, // Will be replaced after async init
    };

    // Initialize revocation store
    let revocation_path = std::path::PathBuf::from(
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    ).join(".terminar").join("revoked-tokens.jsonl");
    match revocation::RevocationStore::new(revocation_path.clone()).await {
        Ok(store) => {
            info!("Revocation store loaded from {:?} ({} revoked tokens)", revocation_path, store.len());
            state.revocation_store = Some(Arc::new(store));
        }
        Err(e) => {
            warn!("Failed to initialize revocation store: {}", e);
        }
    }

    // Initialize audit logger
    let audit_level = audit::AuditLevel::from_str(&cli.audit_level);
    if audit_level != audit::AuditLevel::Off {
        let audit_path = std::path::PathBuf::from(
            std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
        ).join(".terminar").join("audit.log");
        match audit::AuditLogger::new(audit_path.clone(), audit_level).await {
            Ok(logger) => {
                info!("Audit logging enabled, writing to {:?}", audit_path);
                state.audit_logger = Some(Arc::new(logger));
            }
            Err(e) => {
                warn!("Failed to initialize audit logger: {} (audit logging disabled)", e);
            }
        }
    } else {
        info!("Audit logging disabled");
    }

    // Resolve TLS configuration: explicit cert/key > auto-TLS > none
    let home_dir = std::path::PathBuf::from(
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    );
    let tls_dir = home_dir.join(".terminar").join("tls");
    let tls_config = tls::resolve_tls_config(
        cli.tls_cert.as_deref(),
        cli.tls_key.as_deref(),
        cli.tls_port,
        cli.auto_tls,
        &tls_dir,
    )
    .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

    // Log TLS certificate fingerprint for TOFU verification
    if let Some(ref tls_cfg) = tls_config {
        let cert_bytes = std::fs::read(&tls_cfg.cert_path)
            .map_err(|e| format!("Failed to read TLS cert: {}", e))?;
        let fingerprint = tls::compute_cert_fingerprint(&cert_bytes)
            .map_err(|e| format!("Failed to compute fingerprint: {}", e))?;
        info!("TLS certificate fingerprint (SHA-256): {}", fingerprint);
        info!("Verify this fingerprint on first connection (TOFU)");
    }

    // 1. Start HTTP/WebSocket Server
    let cors_layer = create_cors_layer(&cli.cors_origins);

    let security_headers_state = security_headers::SecurityHeadersState {
        tls_enabled: tls_config.is_some(),
    };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health_handler))
        .route("/metrics", get(metrics_handler))
        .route("/pair/exchange", post(exchange_handler))
        .route("/auth/revoke", post(revoke_handler))
        .route("/auth/refresh", post(refresh_handler))
        .route("/settings", get(get_settings_handler))
        .route("/settings", put(put_settings_handler))
        .route("/workspace", get(get_workspace_handler))
        .route("/workspace", put(put_workspace_handler))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(cors_layer)
        .layer(middleware::from_fn_with_state(
            security_headers_state,
            security_headers::security_headers_middleware,
        ))
        .with_state(state.clone());

    let addr = format!("0.0.0.0:{}", cli.port);
    let listener_http = tokio::net::TcpListener::bind(&addr).await?;

    // Create a cancellation token for graceful shutdown
    let mut server_shutdown_rx = shutdown_tx.subscribe();

    // 1b. Start TLS/HTTPS Server (if configured)
    // When TLS is configured, the HTTP port serves redirects to HTTPS
    // and the full app runs only on the TLS port.
    let (server_task, tls_task) = if let Some(ref tls_cfg) = tls_config {
        let tls_port = tls_cfg.port;
        let tls_shutdown_rx = shutdown_tx.subscribe();
        let tls_task = tls::spawn_tls_server(tls_cfg, app, tls_shutdown_rx)
            .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

        // Serve redirect router on the HTTP port
        let redirect_app = build_http_redirect_router(tls_port);
        info!("HTTP listener on http://{} (redirecting to HTTPS port {})", addr, tls_port);

        let server_task = tokio::spawn(async move {
            let server = axum::serve(
                listener_http,
                redirect_app.into_make_service_with_connect_info::<SocketAddr>()
            );
            tokio::select! {
                result = server => {
                    if let Err(e) = result {
                        error!("HTTP redirect server error: {}", e);
                    }
                }
                _ = server_shutdown_rx.recv() => {
                    info!("HTTP redirect server received shutdown signal");
                }
            }
        });

        (server_task, Some(tls_task))
    } else {
        // No TLS: serve the full app on the HTTP port
        info!("Web Interface listening on http://{}", addr);

        let server_task = tokio::spawn(async move {
            let server = axum::serve(
                listener_http,
                app.into_make_service_with_connect_info::<SocketAddr>()
            );
            tokio::select! {
                result = server => {
                    if let Err(e) = result {
                        error!("HTTP server error: {}", e);
                    }
                }
                _ = server_shutdown_rx.recv() => {
                    info!("HTTP server received shutdown signal");
                }
            }
        });
        (server_task, None)
    };

    // 2. Start Unix Socket Server
    let socket_path_owned = socket_path.to_string();
    if std::path::Path::new(socket_path).exists() {
        std::fs::remove_file(socket_path)?;
    }
    let listener_unix = UnixListener::bind(socket_path)?;
    info!("Unix Socket listening on {}", socket_path);

    // Save audit logger reference before state is moved into spawned tasks
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

    // 6. Wait for shutdown signal (SIGTERM or SIGINT)
    let shutdown_signal = async {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigterm = signal(SignalKind::terminate()).expect("Failed to install SIGTERM handler");
            let mut sigint = signal(SignalKind::interrupt()).expect("Failed to install SIGINT handler");

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
            tokio::signal::ctrl_c().await.expect("Failed to install Ctrl+C handler");
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
    let shutdown_result = tokio::time::timeout(
        shutdown_timeout,
        async {
            // Abort tasks (they should have received shutdown signal)
            server_task.abort();
            if let Some(ref tls_handle) = tls_task {
                tls_handle.abort();
            }
            unix_task.abort();

            // Wait a moment for in-flight messages
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    ).await;

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

async fn auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> impl IntoResponse {
    if state.no_auth {
        return next.run(req).await;
    }

    // WebSocket path uses message-based auth (first message must be Auth)
    // This prevents tokens from being logged in URLs
    // Health endpoint is unauthenticated for monitoring/load balancer use
    // Settings and workspace endpoints are also unauthenticated for local connections (managed by CORS)
    if req.uri().path() == "/ws"
        || req.uri().path() == "/pair/exchange"
        || req.uri().path() == "/health"
        || req.uri().path() == "/settings"
        || req.uri().path() == "/workspace" {
        return next.run(req).await;
    }

    let auth_header = req.headers().get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|val| val.strip_prefix("Bearer "));

    let query_token = req.uri().query()
        .and_then(|q| {
            form_urlencoded::parse(q.as_bytes())
                .find(|(k, _)| k == "token")
                .map(|(_, v)| v.to_string())
        });

    let token = auth_header.map(|s| s.to_string()).or(query_token);

    match token {
        Some(val) if val == state.api_key => {
            // Check if token has been revoked
            if state.revoked_tokens.lock().contains(&val) {
                return (StatusCode::UNAUTHORIZED, "Token has been revoked").into_response();
            }
            next.run(req).await
        }
        _ => {
            (StatusCode::UNAUTHORIZED, "Unauthorized").into_response()
        }
    }
}

/// Extract the real client IP address from a request, safely handling X-Forwarded-For.
///
/// When `--trusted-proxy` is configured, only trusts X-Forwarded-For from that IP.
/// When no trusted proxy is set, falls back to XFF then peer IP for backward compatibility.
fn extract_client_ip(
    xff_header: Option<&str>,
    trusted_proxy: Option<&str>,
    peer_ip: Option<&str>,
) -> String {
    // Helper to extract the first (leftmost) IP from an XFF header
    let xff_first_ip = || -> Option<String> {
        xff_header.and_then(|xff| {
            xff.split(',').next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        })
    };

    if let Some(proxy_ip) = trusted_proxy {
        // Strict mode: only trust XFF if request came from the trusted proxy
        if peer_ip == Some(proxy_ip) {
            if let Some(ip) = xff_first_ip() {
                return ip;
            }
        }
        // Request not from trusted proxy — use peer IP, ignore XFF
        return peer_ip.unwrap_or("unknown").to_string();
    }

    // No trusted proxy configured — fall back to XFF then peer IP
    if let Some(ip) = xff_first_ip() {
        return ip;
    }
    peer_ip.unwrap_or("unknown").to_string()
}

async fn exchange_handler(
    State(state): State<AppState>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
    req: Request,
) -> impl IntoResponse {
    let peer_ip = connect_info.map(|ci| ci.0.ip().to_string());
    let xff = req.headers()
        .get("x-forwarded-for")
        .and_then(|h| h.to_str().ok());
    let client_ip = extract_client_ip(
        xff,
        state.trusted_proxy.as_deref(),
        peer_ip.as_deref(),
    );

    let now = Instant::now();

    // Check rate limit with exponential backoff
    {
        let mut attempts = state.pairing_attempts.lock();
        let window = Duration::from_secs(RATE_LIMIT_WINDOW_SECS);

        // Clean up old entries for this IP
        if let Some(timestamps) = attempts.get_mut(&client_ip) {
            timestamps.retain(|t| now.duration_since(*t) < window);

            let attempt_count = timestamps.len();

            // Hard lockout after max attempts (configurable via --max-auth-attempts)
            if attempt_count >= state.max_auth_attempts {
                warn!("Rate limit exceeded for IP: {}", client_ip);
                return (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded. Try again later.").into_response();
            }

            // Exponential backoff: must wait 2^(N-1) seconds after N attempts
            if attempt_count > 0 {
                if let Some(last_attempt) = timestamps.last() {
                    let backoff_secs = 1u64 << (attempt_count - 1); // 1, 2, 4, 8, ...
                    let elapsed = now.duration_since(*last_attempt);
                    if elapsed < Duration::from_secs(backoff_secs) {
                        warn!("Exponential backoff for IP: {} (attempt {}, need {}s wait, only {}s elapsed)",
                            client_ip, attempt_count + 1, backoff_secs, elapsed.as_secs());
                        return (StatusCode::TOO_MANY_REQUESTS, "Too many attempts. Please wait before trying again.").into_response();
                    }
                }
            }
        }

        // Record this attempt
        attempts.entry(client_ip.clone())
            .or_insert_with(Vec::new)
            .push(now);
    }

    // Parse the JSON body
    let body_bytes = match axum::body::to_bytes(req.into_body(), 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid request body").into_response(),
    };

    let payload: ExchangeRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response(),
    };

    // Check pairing code
    let mut guard = state.pairing_codes.lock();
    guard.retain(|_, (_, created)| now.duration_since(*created) < Duration::from_secs(300));

    if let Some((token, _)) = guard.remove(&payload.code) {
        info!("Pairing code {} exchanged for token", payload.code);
        (StatusCode::OK, Json(ExchangeResponse { token })).into_response()
    } else {
        warn!("Invalid or expired pairing code: {}", payload.code);
        (StatusCode::NOT_FOUND, "Invalid or expired code").into_response()
    }
}

/// POST /auth/revoke - Revoke a token
async fn revoke_handler(
    State(state): State<AppState>,
    Json(payload): Json<RevokeRequest>,
) -> impl IntoResponse {
    info!("Revoking token: {}...", &payload.token[..std::cmp::min(8, payload.token.len())]);
    state.revoked_tokens.lock().insert(payload.token);
    (StatusCode::OK, Json(RevokeResponse { status: "revoked".to_string() }))
}

async fn refresh_handler(
    State(state): State<AppState>,
    Json(payload): Json<RefreshRequest>,
) -> impl IntoResponse {
    match jwt::validate_refresh_token(&state.signing_key, &payload.refresh_token) {
        Ok(claims) => {
            // Check if the refresh token has been revoked
            if state.revoked_tokens.lock().contains(&payload.refresh_token) {
                return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Token revoked"}))).into_response();
            }

            // Issue new access token (15 min) and rotate refresh token (7 days)
            let access = jwt::issue_access_token(
                &state.signing_key, &claims.sub, &state.server_id,
                Duration::from_secs(900),
            );
            let refresh = jwt::issue_refresh_token(
                &state.signing_key, &claims.sub, &state.server_id,
                Duration::from_secs(604800),
            );

            match (access, refresh) {
                (Ok(access_token), Ok(refresh_token)) => {
                    // Revoke old refresh token
                    state.revoked_tokens.lock().insert(payload.refresh_token);

                    info!("Refreshed tokens for user: {}", claims.sub);
                    (StatusCode::OK, Json(serde_json::json!({
                        "access_token": access_token,
                        "refresh_token": refresh_token,
                        "expires_in": "15m",
                    }))).into_response()
                }
                _ => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Token generation failed"}))).into_response()
                }
            }
        }
        Err(_) => {
            warn!("Refresh token validation failed");
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid or expired refresh token"}))).into_response()
        }
    }
}

async fn health_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let session_count = state.sessions.lock().len();
    Json(HealthResponse {
        status: "ok".to_string(),
        sessions: session_count,
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Prometheus-style metrics endpoint
async fn metrics_handler(
    State(state): State<AppState>,
) -> impl IntoResponse {
    let (sessions_active, broadcast_subscribers, history_bytes_per_session) = {
        let guard = state.sessions.lock();
        let active = guard.len();
        let subscribers: usize = guard.values().map(|s| s.subscriber_count()).sum();
        let history_bytes: Vec<(String, usize)> = guard.values().map(|s| {
            let h = s.history.lock();
            (s.id.clone(), h.len())
        }).collect();
        (active, subscribers, history_bytes)
    };
    let sessions_total = state.sessions_total.load(std::sync::atomic::Ordering::Relaxed);
    let messages_processed = state.messages_processed_total.load(std::sync::atomic::Ordering::Relaxed);
    let uptime_seconds = state.start_time.elapsed().as_secs();

    // Return in Prometheus exposition format
    let mut metrics = format!(
        "# HELP sessions_active Number of currently active terminal sessions\n\
         # TYPE sessions_active gauge\n\
         sessions_active {}\n\
         # HELP sessions_total_created Total number of sessions created since server start\n\
         # TYPE sessions_total_created counter\n\
         sessions_total_created {}\n\
         # HELP messages_processed_total Total number of messages processed since server start\n\
         # TYPE messages_processed_total counter\n\
         messages_processed_total {}\n\
         # HELP uptime_seconds Server uptime in seconds\n\
         # TYPE uptime_seconds counter\n\
         uptime_seconds {}\n\
         # HELP session_broadcast_subscribers Total active broadcast subscribers across all sessions\n\
         # TYPE session_broadcast_subscribers gauge\n\
         session_broadcast_subscribers {}\n",
        sessions_active, sessions_total, messages_processed, uptime_seconds, broadcast_subscribers
    );

    // Per-session history bytes
    if !history_bytes_per_session.is_empty() {
        metrics.push_str("# HELP history_bytes Current history buffer usage in bytes per session\n");
        metrics.push_str("# TYPE history_bytes gauge\n");
        for (session_id, bytes) in &history_bytes_per_session {
            metrics.push_str(&format!(
                "history_bytes{{session_id=\"{}\"}} {}\n",
                session_id, bytes
            ));
        }
    }

    (
        StatusCode::OK,
        [("content-type", "text/plain; version=0.0.4")],
        metrics,
    )
}

/// GET /settings - Retrieve terminal settings
async fn get_settings_handler() -> impl IntoResponse {
    let settings = settings::load_settings();
    Json(settings)
}

/// PUT /settings - Update terminal settings
async fn put_settings_handler(
    Json(mut settings): Json<settings::TerminalSettings>,
) -> impl IntoResponse {
    // Validate and clamp settings
    settings.validate();

    // Save to disk
    match settings::save_settings(&settings) {
        Ok(()) => (StatusCode::OK, Json(settings)).into_response(),
        Err(e) => {
            error!("Failed to save settings: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to save settings: {}", e),
            )
                .into_response()
        }
    }
}

/// GET /workspace - Retrieve workspace state
async fn get_workspace_handler() -> impl IntoResponse {
    let state = workspace::load_workspace();
    Json(state)
}

/// PUT /workspace - Update workspace state
async fn put_workspace_handler(
    Json(state): Json<workspace::WorkspaceState>,
) -> impl IntoResponse {
    // Save to disk
    match workspace::save_workspace(&state) {
        Ok(()) => (StatusCode::OK, Json(state)).into_response(),
        Err(e) => {
            error!("Failed to save workspace: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to save workspace: {}", e),
            )
                .into_response()
        }
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    connect_info: Option<ConnectInfo<SocketAddr>>,
) -> impl IntoResponse {
    // Determine if this is a local connection
    // If ConnectInfo is not available (e.g., in tests), default to non-local for safety
    let is_local = connect_info
        .map(|ConnectInfo(addr)| addr.ip().is_loopback())
        .unwrap_or(false);

    if let Some(ConnectInfo(addr)) = connect_info {
        info!("WebSocket connection from {} (local: {})", addr, is_local);
    } else {
        info!("WebSocket connection (no address info, treating as remote)");
    }

    let connection_id = Uuid::new_v4().to_string();
    let span = info_span!("websocket", connection_id = %connection_id, is_local = is_local);
    ws.on_upgrade(move |socket| handle_websocket(socket, state, is_local).instrument(span))
}

async fn handle_websocket(socket: WebSocket, state: AppState, is_local: bool) {
    let (mut sender, mut receiver) = socket.split();

    // Phase 1: Authentication
    // Skip auth for:
    // 1. Explicit --no-auth flag (always skips)
    // 2. Local connections UNLESS --require-auth is set
    let skip_auth = state.no_auth || (is_local && !state.require_auth);
    if skip_auth && is_local {
        info!("Local connection - skipping authentication");
    }
    if !skip_auth {
        let auth_timeout = tokio::time::timeout(
            Duration::from_secs(30),
            async {
                let mut auth_attempts: usize = 0;
                while let Some(Ok(msg)) = receiver.next().await {
                    if let Message::Text(text) = msg {
                        // Check rate limit before processing any auth message
                        auth_attempts += 1;
                        if auth_attempts > MAX_WS_AUTH_ATTEMPTS {
                            warn!("WebSocket auth rate limit exceeded ({} attempts)", auth_attempts);
                            if let Some(ref logger) = state.audit_logger {
                                logger.log(audit::AuditEvent::auth_rate_limited("websocket", auth_attempts));
                            }
                            let err_msg = ServerMessage::Error {
                                message: "Too many authentication attempts".to_string(),
                                error_code: Some("RATE_LIMIT_EXCEEDED".to_string()),
                            };
                            let _ = sender.send(Message::Text(
                                serde_json::to_string(&err_msg).unwrap()
                            )).await;
                            return Some(false);
                        }

                        match serde_json::from_str::<ClientMessage>(&text) {
                            // Legacy token auth (UUID)
                            Ok(ClientMessage::Auth { token, .. }) => {
                                if token == state.api_key {
                                    // Send AuthOk with a JWT for future reconnections
                                    if let Ok(jwt) = jwt::issue_token(
                                        &state.signing_key, "token-user", &state.server_id,
                                        Duration::from_secs(constants::ACCESS_TOKEN_EXPIRY_SECS),
                                    ) {
                                        let ok_msg = ServerMessage::AuthOk {
                                            token: jwt,
                                            expires: format!("{}s", constants::ACCESS_TOKEN_EXPIRY_SECS),
                                            protocol_version: Some(constants::PROTOCOL_VERSION.to_string()),
                                            refresh_token: None,
                                        };
                                        let _ = sender.send(Message::Text(
                                            serde_json::to_string(&ok_msg).unwrap()
                                        )).await;
                                    }
                                    return Some(true);
                                }
                                let err_msg = ServerMessage::Error {
                                    message: "Authentication failed".to_string(),
                                    error_code: Some("AUTH_FAILED".to_string()),
                                };
                                let _ = sender.send(Message::Text(
                                    serde_json::to_string(&err_msg).unwrap()
                                )).await;
                                continue; // Allow retry
                            }
                            // Password auth (PAM)
                            Ok(ClientMessage::AuthPassword { username, password }) => {
                                if let Some(ref verifier) = state.password_verifier {
                                    match auth::handle_password_auth(
                                        verifier.as_ref(),
                                        &state.signing_key,
                                        &state.server_id,
                                        &username,
                                        &password,
                                        Duration::from_secs(constants::ACCESS_TOKEN_EXPIRY_SECS),
                                    ) {
                                        Ok(result) => {
                                            let ok_msg = ServerMessage::AuthOk {
                                                token: result.token,
                                                expires: result.expires,
                                                protocol_version: Some(constants::PROTOCOL_VERSION.to_string()),
                                                refresh_token: None,
                                            };
                                            let _ = sender.send(Message::Text(
                                                serde_json::to_string(&ok_msg).unwrap()
                                            )).await;
                                            return Some(true);
                                        }
                                        Err(e) => {
                                            warn!("Password auth failed for {}: {}", username, e);
                                            let err_msg = ServerMessage::Error {
                                                message: "Authentication failed".to_string(),
                                                error_code: Some("AUTH_FAILED".to_string()),
                                            };
                                            let _ = sender.send(Message::Text(
                                                serde_json::to_string(&err_msg).unwrap()
                                            )).await;
                                            continue; // Allow retry
                                        }
                                    }
                                }
                                // No password verifier configured
                                let err_msg = ServerMessage::Error {
                                    message: "Password authentication not available".to_string(),
                                    error_code: Some("AUTH_FAILED".to_string()),
                                };
                                let _ = sender.send(Message::Text(
                                    serde_json::to_string(&err_msg).unwrap()
                                )).await;
                                continue; // Allow retry with different method
                            }
                            // JWT token auth (reconnection)
                            Ok(ClientMessage::AuthToken { token }) => {
                                match auth::handle_token_auth(&state.signing_key, &token) {
                                    Ok(result) => {
                                        let ok_msg = ServerMessage::AuthOk {
                                            token: result.token,
                                            expires: result.expires,
                                            protocol_version: Some(constants::PROTOCOL_VERSION.to_string()),
                                            refresh_token: None,
                                        };
                                        let _ = sender.send(Message::Text(
                                            serde_json::to_string(&ok_msg).unwrap()
                                        )).await;
                                        return Some(true);
                                    }
                                    Err(e) => {
                                        warn!("Token auth failed: {}", e);
                                        let err_msg = ServerMessage::Error {
                                            message: "Token authentication failed".to_string(),
                                            error_code: Some("AUTH_FAILED".to_string()),
                                        };
                                        let _ = sender.send(Message::Text(
                                            serde_json::to_string(&err_msg).unwrap()
                                        )).await;
                                        continue; // Allow retry
                                    }
                                }
                            }
                            // Refresh token rotation
                            Ok(ClientMessage::RefreshToken { refresh_token }) => {
                                // Validate the refresh token
                                match jwt::validate_refresh_token(&state.signing_key, &refresh_token) {
                                    Ok(claims) => {
                                        // Check if token has been revoked
                                        if let Some(ref store) = state.revocation_store {
                                            if store.is_revoked(&claims.jti) {
                                                warn!("Attempted reuse of revoked refresh token jti={}", claims.jti);
                                                let err_msg = ServerMessage::Error {
                                                    message: "Refresh token has been revoked".to_string(),
                                                    error_code: Some("TOKEN_REVOKED".to_string()),
                                                };
                                                let _ = sender.send(Message::Text(
                                                    serde_json::to_string(&err_msg).unwrap()
                                                )).await;
                                                continue;
                                            }
                                        }

                                        // Revoke old refresh token
                                        if let Some(ref store) = state.revocation_store {
                                            store.revoke(&claims.jti, "rotation", Some(claims.exp));
                                        }

                                        // Issue new access token
                                        let new_access = jwt::issue_access_token(
                                            &state.signing_key, &claims.sub, &state.server_id,
                                            Duration::from_secs(constants::ACCESS_TOKEN_EXPIRY_SECS),
                                        );
                                        // Issue new refresh token
                                        let new_refresh = jwt::issue_refresh_token(
                                            &state.signing_key, &claims.sub, &state.server_id,
                                            Duration::from_secs(constants::REFRESH_TOKEN_EXPIRY_SECS),
                                        );

                                        match (new_access, new_refresh) {
                                            (Ok(access_jwt), Ok(refresh_jwt)) => {
                                                if let Some(ref logger) = state.audit_logger {
                                                    logger.log(audit::AuditEvent::token_revoked(
                                                        &claims.jti, "rotation",
                                                    ));
                                                }
                                                let ok_msg = ServerMessage::AuthOk {
                                                    token: access_jwt,
                                                    expires: format!("{}s", constants::ACCESS_TOKEN_EXPIRY_SECS),
                                                    protocol_version: Some(constants::PROTOCOL_VERSION.to_string()),
                                                    refresh_token: Some(refresh_jwt),
                                                };
                                                let _ = sender.send(Message::Text(
                                                    serde_json::to_string(&ok_msg).unwrap()
                                                )).await;
                                                return Some(true);
                                            }
                                            _ => {
                                                let err_msg = ServerMessage::Error {
                                                    message: "Failed to issue new tokens".to_string(),
                                                    error_code: Some("INTERNAL_ERROR".to_string()),
                                                };
                                                let _ = sender.send(Message::Text(
                                                    serde_json::to_string(&err_msg).unwrap()
                                                )).await;
                                                continue;
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        warn!("Refresh token validation failed: {}", e);
                                        let err_msg = ServerMessage::Error {
                                            message: "Invalid refresh token".to_string(),
                                            error_code: Some("AUTH_FAILED".to_string()),
                                        };
                                        let _ = sender.send(Message::Text(
                                            serde_json::to_string(&err_msg).unwrap()
                                        )).await;
                                        continue;
                                    }
                                }
                            }
                            // SSH pubkey auth - step 1: init challenge
                            Ok(ClientMessage::AuthPubkeyInit { username, pubkey }) => {
                                // Look up the user's home directory
                                let home_dir = std::path::PathBuf::from(
                                    std::env::var("HOME")
                                        .or_else(|_| std::env::var("USERPROFILE"))
                                        .unwrap_or_else(|_| format!("/home/{}", username))
                                );
                                match auth::handle_pubkey_init(&home_dir, &username, &pubkey) {
                                    Ok(challenge) => {
                                        let challenge_msg = ServerMessage::AuthChallenge {
                                            nonce: challenge.nonce.clone(),
                                        };
                                        let _ = sender.send(Message::Text(
                                            serde_json::to_string(&challenge_msg).unwrap()
                                        )).await;
                                        // Wait for step 2: verify signature
                                        while let Some(Ok(msg2)) = receiver.next().await {
                                            if let Message::Text(text2) = msg2 {
                                                match serde_json::from_str::<ClientMessage>(&text2) {
                                                    Ok(ClientMessage::AuthPubkeyVerify { signature, algorithm: _ }) => {
                                                        match auth::handle_pubkey_verify(
                                                            &challenge,
                                                            &state.signing_key,
                                                            &state.server_id,
                                                            &signature,
                                                            Duration::from_secs(constants::ACCESS_TOKEN_EXPIRY_SECS),
                                                        ) {
                                                            Ok(result) => {
                                                                let ok_msg = ServerMessage::AuthOk {
                                                                    token: result.token,
                                                                    expires: result.expires,
                                                                    protocol_version: Some(constants::PROTOCOL_VERSION.to_string()),
                                                                    refresh_token: None,
                                                                };
                                                                let _ = sender.send(Message::Text(
                                                                    serde_json::to_string(&ok_msg).unwrap()
                                                                )).await;
                                                                return Some(true);
                                                            }
                                                            Err(e) => {
                                                                warn!("Pubkey signature verification failed: {}", e);
                                                                let err_msg = ServerMessage::Error {
                                                                    message: "Signature verification failed".to_string(),
                                                                    error_code: Some("AUTH_FAILED".to_string()),
                                                                };
                                                                let _ = sender.send(Message::Text(
                                                                    serde_json::to_string(&err_msg).unwrap()
                                                                )).await;
                                                                return Some(false);
                                                            }
                                                        }
                                                    }
                                                    _ => return Some(false),
                                                }
                                            }
                                        }
                                        return None;
                                    }
                                    Err(e) => {
                                        warn!("Pubkey init failed for {}: {}", username, e);
                                        let err_msg = ServerMessage::Error {
                                            message: "Public key not authorized".to_string(),
                                            error_code: Some("AUTH_FAILED".to_string()),
                                        };
                                        let _ = sender.send(Message::Text(
                                            serde_json::to_string(&err_msg).unwrap()
                                        )).await;
                                        continue; // Allow retry
                                    }
                                }
                            }
                            // SSH pubkey verify without init - reject
                            Ok(ClientMessage::AuthPubkeyVerify { .. }) => {
                                let err_msg = ServerMessage::Error {
                                    message: "Authentication failed".to_string(),
                                    error_code: Some("AUTH_FAILED".to_string()),
                                };
                                let _ = sender.send(Message::Text(
                                    serde_json::to_string(&err_msg).unwrap()
                                )).await;
                                continue; // Allow retry
                            }
                            _ => {
                                // Message wasn't an auth type - reject
                                let err_msg = ServerMessage::Error {
                                    message: "Authentication required".to_string(),
                                    error_code: Some("AUTH_FAILED".to_string()),
                                };
                                let _ = sender.send(Message::Text(
                                    serde_json::to_string(&err_msg).unwrap()
                                )).await;
                                continue; // Allow retry
                            }
                        }
                    }
                }
                None // Connection closed before auth
            }
        ).await;

        let authenticated = match auth_timeout {
            Ok(Some(true)) => true,
            Ok(Some(false)) => {
                warn!("WebSocket authentication failed");
                if let Some(ref logger) = state.audit_logger {
                    logger.log(audit::AuditEvent::auth_failure(None, "websocket", "unknown", "authentication failed"));
                }
                let _ = sender.close().await;
                return;
            }
            Ok(None) | Err(_) => {
                warn!("WebSocket authentication timeout or connection closed");
                return;
            }
        };

        if !authenticated {
            return;
        }
        info!("WebSocket client authenticated successfully");
        if let Some(ref logger) = state.audit_logger {
            logger.log(audit::AuditEvent::auth_success("unknown", "websocket", "unknown", "websocket"));
        }
    }

    // Determine client_id for workspace persistence.
    // Local/no-auth connections use "local" (stable identifier for the single local user).
    // Remote authenticated connections would ideally use a hash of the auth identity.
    let client_id = if is_local || state.no_auth {
        "local".to_string()
    } else {
        // For remote authenticated connections, use a UUID per connection.
        // Future enhancement: derive from authenticated user identity (username, token hash).
        Uuid::new_v4().to_string()
    };

    // Phase 2: Normal message processing with ping/pong health monitoring
    let (tx_out, mut rx_out) = mpsc::channel::<ServerMessage>(32);
    let sessions = state.sessions.clone();

    // Channel for pong notifications from read_task to write_task
    let (pong_tx, mut pong_rx) = mpsc::channel::<()>(4);

    let mut write_task = tokio::spawn(async move {
        use crate::connection::{ConnectionHealth, PING_INTERVAL};

        let mut health = ConnectionHealth::new();
        let mut ping_interval = tokio::time::interval(PING_INTERVAL);
        // Skip the first tick (don't ping immediately)
        ping_interval.tick().await;

        loop {
            tokio::select! {
                // Send queued messages
                msg = rx_out.recv() => {
                    match msg {
                        Some(msg) => {
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if sender.send(Message::Text(json)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        None => break, // Channel closed
                    }
                }
                // Send periodic pings
                _ = ping_interval.tick() => {
                    let now = Instant::now();
                    if health.is_stale(now) {
                        warn!("WebSocket connection stale (no pong received), closing");
                        let _ = sender.close().await;
                        break;
                    }
                    if health.should_send_ping(now) {
                        health.record_ping_sent(now);
                        if sender.send(Message::Ping(vec![])).await.is_err() {
                            break;
                        }
                    }
                }
                // Process pong notifications
                _ = pong_rx.recv() => {
                    let now = Instant::now();
                    health.record_pong_received(now);
                    if let Some(latency) = health.latency() {
                        tracing::trace!("WebSocket latency: {:?}", latency);
                    }
                }
            }
        }
    });

    let mut read_task = tokio::spawn(async move {
        let mut attach_tasks = handlers::io::AttachTasks::new();
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Text(text) => {
                    match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(client_msg) => {
                            // Skip auth messages after initial auth (already authenticated)
                            if matches!(client_msg,
                                ClientMessage::Auth { .. } |
                                ClientMessage::AuthPassword { .. } |
                                ClientMessage::AuthToken { .. } |
                                ClientMessage::AuthPubkeyInit { .. } |
                                ClientMessage::AuthPubkeyVerify { .. }
                            ) {
                                continue;
                            }
                            if let Err(e) = process_message(&client_msg, &tx_out, &sessions, &state, &mut attach_tasks, &client_id).await {
                                error!("Process error: {}", e);
                            }
                        }
                        Err(e) => error!("JSON Error: {}", e),
                    }
                }
                Message::Pong(_) => {
                    // Notify the write task that a pong was received
                    let _ = pong_tx.send(()).await;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        // Abort all attach forwarder tasks when the connection closes
        for (_, task) in attach_tasks {
            task.abort();
        }
    });

    tokio::select! {
        _ = (&mut write_task) => read_task.abort(),
        _ = (&mut read_task) => write_task.abort(),
    };
}

/// Handle Unix socket connection using length-prefixed framing.
/// Frame format: 4-byte big-endian length + JSON payload
/// This prevents protocol corruption when JSON contains newlines or binary data.
async fn handle_connection<S>(
    socket: S,
    sessions: SessionMap,
    state: AppState
) -> Result<(), Box<dyn std::error::Error>>
where S: AsyncRead + AsyncWrite + Unpin + Send + 'static {
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
                        if let Err(e) = process_message(&msg, &tx_out, &sessions, &state, &mut attach_tasks, client_id).await {
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
    state.messages_processed_total.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    info!(message_type = %format!("{:?}", std::mem::discriminant(msg)), "Received message: {:?}", msg);
    let result = process_message_inner(msg, tx_out, sessions, state, attach_tasks, client_id).await;
    let elapsed = process_start.elapsed();
    info!(
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
        ClientMessage::PairRequest => {
            handlers::auth::handle_pair_request(tx_out, state).await?;
        }
        ClientMessage::ListSessions => {
            handlers::session::handle_list_sessions(tx_out, sessions).await?;
        }
        ClientMessage::CreateSession { cwd, shell, env, cols, rows } => {
            handlers::session::handle_create_session(
                cwd, shell, env, *cols, *rows, tx_out, sessions, state,
            ).await?;
        }
        ClientMessage::RenameSession { session_id, new_name } => {
            handlers::session::handle_rename_session(session_id, new_name, tx_out, sessions).await?;
        }
        ClientMessage::KillSession { session_id } => {
            handlers::session::handle_kill_session(session_id, tx_out, sessions, state).await?;
        }
        ClientMessage::Attach { session_id, mode: _ } => {
            handlers::io::handle_attach(session_id, tx_out, sessions, attach_tasks).await?;
        }
        ClientMessage::Input { session_id, data } => {
            handlers::io::handle_input(session_id, data, tx_out, sessions).await?;
        }
        ClientMessage::Resize { session_id, cols, rows } => {
            handlers::io::handle_resize(session_id, *cols, *rows, tx_out, sessions).await?;
        }
        ClientMessage::SaveWorkspace { workspace } => {
            handlers::workspace::handle_save_workspace(client_id, workspace, tx_out).await?;
        }
        ClientMessage::LoadWorkspace => {
            handlers::workspace::handle_load_workspace(client_id, tx_out).await?;
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use parking_lot::Mutex;  // Use parking_lot to match production code
    use std::collections::HashMap;
    use tokio::sync::mpsc;

    fn create_test_state() -> (AppState, mpsc::Receiver<ServerMessage>) {
        let sessions = Arc::new(Mutex::new(HashMap::new()));
        let api_key = "test-key".to_string();
        let pairing_codes = Arc::new(Mutex::new(HashMap::new()));

        // Use Mock Pty
        let mock_provider = Some(Arc::new(MockPtyProvider));

        // Create shutdown channel for tests
        let (shutdown_tx, _) = broadcast::channel::<()>(1);

        let state = AppState {
            sessions,
            api_key,
            pairing_codes,
            pairing_attempts: Arc::new(Mutex::new(HashMap::new())),
            no_auth: true,
            mock_provider,
            shutdown_tx,
            start_time: Instant::now(),
            sessions_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            messages_processed_total: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            session_name_counter: Arc::new(std::sync::atomic::AtomicU64::new(1)),
            revoked_tokens: Arc::new(Mutex::new(HashSet::new())),
            signing_key: Arc::new(jwt::generate_signing_key()),
            server_id: "test-server".to_string(),
            password_verifier: None,
            max_auth_attempts: 5,
            trusted_proxy: None,
            audit_logger: None,
            require_auth: false,
            revocation_store: None,
        };

        let (_, rx) = mpsc::channel(32);
        (state, rx)
    }

    #[tokio::test]
    async fn test_pair_request() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::PairRequest;
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        if let Some(ServerMessage::PairResponse { code, expiry_secs }) = rx.recv().await {
            assert_eq!(code.len(), 8);
            assert_eq!(expiry_secs, 300);

            // Verify code is in state
            let guard = state.pairing_codes.lock();
            assert!(guard.contains_key(&code));
        } else {
            panic!("Expected PairResponse");
        }
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
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
        process_message(&rename_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions[0].name, "Production");
            },
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // Kill
        let kill_msg = ClientMessage::KillSession { session_id: id.clone() };
        process_message(&kill_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

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

        process_message(&ClientMessage::ListSessions, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
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
        process_message(&attach_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        
        // Initial Output (history - empty)
        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert_eq!(data, "");
            },
            _ => panic!("Expected initial Output"),
        }

        // Input
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "hello".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive echo
        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert_eq!(data, "hello");
            },
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
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
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Give thread time to read and update history
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Attach - Should receive history
        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(&attach_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert!(data.contains("HistoryTest"));
            },
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
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
        process_message(&attach_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        // Drain history output
        rx.recv().await.unwrap();

        // Second attach (should cancel the first forwarder)
        process_message(&attach_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        // Drain history output
        rx.recv().await.unwrap();

        // Send input - should only produce ONE output (not duplicated)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive exactly one output
        match rx.recv().await.unwrap() {
            ServerMessage::Output { data, .. } => assert_eq!(data, "test"),
            other => panic!("Expected Output, got {:?}", other),
        }

        // Give a moment for any duplicate to arrive
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Channel should be empty (no duplicate)
        assert!(rx.try_recv().is_err(), "Received duplicate output - old forwarder was not cancelled");
    }

    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt; // for oneshot/ready

    #[tokio::test]
    async fn test_auth_middleware_no_auth() {
        // State with no_auth = true
        let (state, _) = create_test_state(); 
        // create_test_state sets no_auth = true by default.
        
        let app = Router::new()
            .route("/", get(|| async { "OK" }))
            .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state);

        let req = Request::builder().uri("/").body(Body::empty()).unwrap();
        let response = app.oneshot(req).await.unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_auth_middleware_with_auth_success() {
        let (mut state, _) = create_test_state();
        state.no_auth = false; // Enable auth
        state.api_key = "secret".to_string();

        let app = Router::new()
            .route("/", get(|| async { "OK" }))
            .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state);

        // 1. Query Param
        let req = Request::builder().uri("/?token=secret").body(Body::empty()).unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // 2. Header
        let req = Request::builder()
            .uri("/")
            .header("Authorization", "Bearer secret")
            .body(Body::empty()).unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_auth_middleware_failure() {
        let (mut state, _) = create_test_state();
        state.no_auth = false;
        state.api_key = "secret".to_string();

        let app = Router::new()
            .route("/", get(|| async { "OK" }))
            .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state);

        // Wrong token
        let req = Request::builder().uri("/?token=wrong").body(Body::empty()).unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        // No token
        let req = Request::builder().uri("/").body(Body::empty()).unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_handle_connection_length_prefixed_framing() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (state, _) = create_test_state();
        let (mut client_io, server_io) = tokio::io::duplex(1024);

        tokio::spawn(async move {
            handle_connection(server_io, state.sessions.clone(), state.clone()).await.unwrap();
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
            &ClientMessage::Input { session_id: "bad".into(), data: "x".into() },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not found"), "Expected 'not found', got: {}", message);
            },
            other => panic!("Expected Error for input to unknown session, got {:?}", other),
        }

        // Resize unknown - should get error
        process_message(
            &ClientMessage::Resize { session_id: "bad".into(), cols: 10, rows: 10 },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not found"), "Expected 'not found', got: {}", message);
            },
            other => panic!("Expected Error for resize of unknown session, got {:?}", other),
        }

        // Attach unknown - silent (no data to send)
        process_message(
            &ClientMessage::Attach { session_id: "bad".into(), mode: "rw".into() },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();
        assert!(rx.try_recv().is_err());
    }

    // ==================== Task 3.4.2: Write Error Handling Tests ====================

    #[tokio::test]
    async fn test_input_to_nonexistent_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Input to a session that doesn't exist
        process_message(
            &ClientMessage::Input { session_id: "nonexistent".into(), data: "hello".into() },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();

        // Should receive an Error message about session not found
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not found") || message.contains("nonexistent"),
                    "Error should indicate session not found, got: {}", message);
            },
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
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
            &ClientMessage::Input { session_id: id.clone(), data: "hello".into() },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();

        // Should receive an Error message about session state
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("error") || message.contains("not accepting"),
                    "Error should indicate session not accepting input, got: {}", message);
            },
            other => panic!("Expected Error message for errored session, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_resize_nonexistent_session_returns_error() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Resize a session that doesn't exist
        process_message(
            &ClientMessage::Resize { session_id: "nonexistent".into(), cols: 80, rows: 24 },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();

        // Should receive an Error message
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not found") || message.contains("nonexistent"),
                    "Error should indicate session not found, got: {}", message);
            },
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive SessionList (success), not Error
        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].shell, "/bin/bash");
            },
            ServerMessage::Error { message, .. } => panic!("Expected SessionList but got Error: {}", message),
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive SessionList (success), not Error
        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].shell, "/bin/sh");
            },
            ServerMessage::Error { message, .. } => panic!("Expected SessionList but got Error: {}", message),
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive Error, not SessionList
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not allowed") || message.contains("whitelist") || message.contains("invalid"),
                    "Error message should indicate shell is not allowed: {}", message);
            },
            ServerMessage::SessionList { .. } => panic!("Expected Error but got SessionList - non-whitelisted shell was allowed!"),
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive Error - path traversal attempts must be rejected
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not allowed") || message.contains("traversal") || message.contains("invalid"),
                    "Error message should indicate path traversal is not allowed: {}", message);
            },
            ServerMessage::SessionList { .. } => panic!("Expected Error but got SessionList - path traversal was allowed!"),
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
            shell: "bash".to_string(),  // Relative path - should be rejected
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        };

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive Error - relative paths without full path are not allowed
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not allowed") || message.contains("whitelist") || message.contains("absolute"),
                    "Error message should indicate relative path is not allowed: {}", message);
            },
            ServerMessage::SessionList { .. } => panic!("Expected Error but got SessionList - relative path was allowed!"),
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

        assert!(!filtered.contains_key("LD_PRELOAD"), "LD_PRELOAD should be filtered out");
        assert!(filtered.contains_key("PATH"), "PATH should be allowed");
        assert!(filtered.contains_key("HOME"), "HOME should be allowed");
    }

    #[test]
    fn test_filter_env_blocks_dyld_vars() {
        let mut env = HashMap::new();
        env.insert("DYLD_INSERT_LIBRARIES".to_string(), "/evil.dylib".to_string());
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
        assert!(filtered.contains_key("ld_preload"), "lowercase should be allowed (case-sensitive)");
        assert!(!filtered.contains_key("LD_PRELOAD"), "uppercase should be blocked");
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
        assert_eq!(clamp_dimension(1000, "rows"), 500, "1000 should clamp to 500");
        assert_eq!(clamp_dimension(u16::MAX, "cols"), 500, "max u16 should clamp to 500");
    }

    // Rate limiting tests

    #[tokio::test]
    async fn test_rate_limit_allows_first_attempt() {
        let (mut state, _) = create_test_state();
        state.no_auth = true;

        let app = Router::new()
            .route("/pair/exchange", post(exchange_handler))
            .route("/auth/revoke", post(revoke_handler))
            .with_state(state.clone());

        // First attempt should always be allowed (no prior failures)
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.168.1.100")
            .body(Body::from("{\"code\":\"wrong0\"}"))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "First attempt should not be rate limited");
    }

    #[tokio::test]
    async fn test_rate_limit_rapid_second_attempt_blocked_by_backoff() {
        let (mut state, _) = create_test_state();
        state.no_auth = true;

        let app = Router::new()
            .route("/pair/exchange", post(exchange_handler))
            .route("/auth/revoke", post(revoke_handler))
            .with_state(state.clone());

        // First attempt (allowed)
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.168.1.100")
            .body(Body::from("{\"code\":\"wrong0\"}"))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);

        // Second attempt immediately (blocked by 1s backoff)
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.168.1.100")
            .body(Body::from("{\"code\":\"wrong1\"}"))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "Rapid second attempt should be blocked by exponential backoff");
    }

    #[tokio::test]
    async fn test_rate_limit_hard_lockout_after_five_attempts() {
        let (mut state, _) = create_test_state();
        state.no_auth = true;

        // Pre-populate with 5 failed attempts (spaced out to not trigger backoff)
        {
            let mut attempts = state.pairing_attempts.lock();
            let base = Instant::now() - Duration::from_secs(60);
            attempts.insert("192.168.1.101".to_string(), vec![
                base,
                base + Duration::from_secs(2),
                base + Duration::from_secs(6),
                base + Duration::from_secs(14),
                base + Duration::from_secs(30),
            ]);
        }

        let app = Router::new()
            .route("/pair/exchange", post(exchange_handler))
            .route("/auth/revoke", post(revoke_handler))
            .with_state(state.clone());

        // 6th attempt should be hard-locked out regardless of timing
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.168.1.101")
            .body(Body::from("{\"code\":\"wrong6\"}"))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "6th attempt should be hard-locked out after 5 failures");
    }

    #[tokio::test]
    async fn test_rate_limit_different_ips_are_independent() {
        let (mut state, _) = create_test_state();
        state.no_auth = true;

        // Pre-populate IP A with 5 failed attempts (hard lockout)
        {
            let mut attempts = state.pairing_attempts.lock();
            let base = Instant::now() - Duration::from_secs(60);
            attempts.insert("10.0.0.1".to_string(), vec![
                base,
                base + Duration::from_secs(2),
                base + Duration::from_secs(6),
                base + Duration::from_secs(14),
                base + Duration::from_secs(30),
            ]);
        }

        let app = Router::new()
            .route("/pair/exchange", post(exchange_handler))
            .route("/auth/revoke", post(revoke_handler))
            .with_state(state.clone());

        // IP A should be locked out
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "10.0.0.1")
            .body(Body::from("{\"code\":\"wrong\"}"))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "IP A should be locked out");

        // IP B should still be allowed (first attempt)
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "10.0.0.2")
            .body(Body::from("{\"code\":\"wrong\"}"))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "Different IP should not be rate limited");
    }

    // PTY buffer size constant tests

    #[test]
    fn test_pty_read_buffer_size_constant_is_16384() {
        // Verify the constant is public and has the correct value
        assert_eq!(PTY_READ_BUFFER_SIZE, 16384,
            "PTY_READ_BUFFER_SIZE should be 16384 bytes (16KB)");
    }

    // Panic handling tests
    // Note: Testing std::panic::catch_unwind directly is difficult because:
    // 1. The PTY reader loop runs in spawn_blocking
    // 2. We can't easily inject panics into the mock PTY reader
    // However, we verify the structure is correct and existing tests still pass

    #[test]
    fn test_catch_unwind_extracts_string_panic_message() {
        // Test that our panic message extraction logic works correctly
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
        // Test that we handle non-string panic types gracefully
        let result = std::panic::catch_unwind(|| {
            std::panic::panic_any(42i32); // Panic with non-string type
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
        // Verify we can subscribe to the shutdown channel
        let _rx = state.shutdown_tx.subscribe();
    }

    #[tokio::test]
    async fn test_shutdown_channel_broadcasts_to_subscribers() {
        let (state, _) = create_test_state();
        let mut rx1 = state.shutdown_tx.subscribe();
        let mut rx2 = state.shutdown_tx.subscribe();

        // Send shutdown signal
        let _ = state.shutdown_tx.send(());

        // Both receivers should get the signal
        assert!(rx1.recv().await.is_ok(), "First subscriber should receive shutdown");
        assert!(rx2.recv().await.is_ok(), "Second subscriber should receive shutdown");
    }

    #[tokio::test]
    async fn test_shutdown_signal_stops_message_processing() {
        let (state, _) = create_test_state();
        let mut rx = state.shutdown_tx.subscribe();

        // Create a task that waits for shutdown
        let task = tokio::spawn(async move {
            rx.recv().await.is_ok()
        });

        // Small delay to ensure task is waiting
        tokio::time::sleep(Duration::from_millis(10)).await;

        // Send shutdown
        let _ = state.shutdown_tx.send(());

        // Task should complete
        let result = tokio::time::timeout(Duration::from_secs(1), task).await;
        assert!(result.is_ok(), "Task should complete after shutdown signal");
        assert!(result.unwrap().unwrap(), "Task should have received shutdown signal");
    }

    #[test]
    fn test_shutdown_message_type_exists() {
        // Verify the Shutdown message variant exists and can be created
        let msg = ServerMessage::Shutdown { reason: "Test shutdown".to_string() };
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
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

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
        // Verify the shutdown timeout constant exists
        assert_eq!(SHUTDOWN_TIMEOUT_SECS, 5, "Shutdown timeout should be 5 seconds");
    }

    // === Task 2.1.3: Pairing Code Hardening ===

    #[tokio::test]
    async fn test_pairing_code_is_8_digits() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();

        let msg = ClientMessage::PairRequest;
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        if let Some(ServerMessage::PairResponse { code, expiry_secs }) = rx.recv().await {
            assert_eq!(code.len(), 8, "Pairing code should be 8 digits, got: {}", code);
            assert_eq!(expiry_secs, 300);
            // Verify all characters are digits
            assert!(code.chars().all(|c| c.is_ascii_digit()),
                "Pairing code should be all digits, got: {}", code);
        } else {
            panic!("Expected PairResponse");
        }
    }

    #[tokio::test]
    async fn test_exponential_backoff_blocks_rapid_attempts() {
        // Exponential backoff: after N failed attempts, must wait 2^(N-1) seconds
        // So after 2 rapid failures, the 3rd attempt should be blocked if too soon
        let (mut state, _) = create_test_state();
        state.no_auth = true;

        // Pre-populate with 2 rapid failed attempts
        {
            let mut attempts = state.pairing_attempts.lock();
            let now = Instant::now();
            attempts.insert("192.168.1.200".to_string(), vec![now, now]);
        }

        let app = Router::new()
            .route("/pair/exchange", post(exchange_handler))
        .route("/auth/revoke", post(revoke_handler))
            .with_state(state.clone());

        // 3rd attempt immediately after 2 rapid failures should be blocked by backoff
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.168.1.200")
            .body(Body::from("{\"code\":\"wrong3\"}"))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "3rd rapid attempt should be blocked by exponential backoff");
    }

    #[tokio::test]
    async fn test_exponential_backoff_allows_after_wait() {
        // After waiting the required backoff period, attempts should be allowed
        let (mut state, _) = create_test_state();
        state.no_auth = true;

        // Pre-populate with 1 failed attempt from 5 seconds ago (backoff for attempt 2 = 1s)
        {
            let mut attempts = state.pairing_attempts.lock();
            let old = Instant::now() - Duration::from_secs(5);
            attempts.insert("192.168.1.201".to_string(), vec![old]);
        }

        let app = Router::new()
            .route("/pair/exchange", post(exchange_handler))
        .route("/auth/revoke", post(revoke_handler))
            .with_state(state.clone());

        // 2nd attempt after sufficient wait should be allowed
        let req = Request::builder()
            .method("POST")
            .uri("/pair/exchange")
            .header("Content-Type", "application/json")
            .header("X-Forwarded-For", "192.168.1.201")
            .body(Body::from("{\"code\":\"wrong2\"}"))
            .unwrap();

        let response = app.clone().oneshot(req).await.unwrap();
        assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS,
            "Attempt after sufficient backoff wait should be allowed");
    }

    // === Task 2.1.4: Token Revocation ===

    #[tokio::test]
    async fn test_revoked_token_is_rejected() {
        let (mut state, _) = create_test_state();
        state.no_auth = false;
        state.api_key = "valid-token".to_string();

        // Revoke the token
        state.revoked_tokens.lock().insert("valid-token".to_string());

        let app = Router::new()
            .route("/", get(|| async { "OK" }))
            .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state);

        let req = Request::builder()
            .uri("/")
            .header("Authorization", "Bearer valid-token")
            .body(Body::empty()).unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED,
            "Revoked token should be rejected");
    }

    #[tokio::test]
    async fn test_revoke_endpoint_revokes_token() {
        let (mut state, _) = create_test_state();
        state.no_auth = false;
        state.api_key = "admin-token".to_string();

        let app = Router::new()
            .route("/auth/revoke", post(revoke_handler))
            .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state.clone());

        // Revoke a token
        let req = Request::builder()
            .method("POST")
            .uri("/auth/revoke")
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer admin-token")
            .body(Body::from("{\"token\":\"token-to-revoke\"}"))
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        // Verify it was stored in revoked set
        assert!(state.revoked_tokens.lock().contains("token-to-revoke"));
    }

    #[tokio::test]
    async fn test_non_revoked_token_still_works() {
        let (mut state, _) = create_test_state();
        state.no_auth = false;
        state.api_key = "good-token".to_string();

        // Revoke a DIFFERENT token
        state.revoked_tokens.lock().insert("other-token".to_string());

        let app = Router::new()
            .route("/", get(|| async { "OK" }))
            .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
            .with_state(state);

        let req = Request::builder()
            .uri("/")
            .header("Authorization", "Bearer good-token")
            .body(Body::empty()).unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK,
            "Non-revoked token should still work");
    }

    // === Task 2.3.3: Working Directory Validation ===

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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("traversal") || message.contains(".."),
                    "Error should mention path traversal, got: {}", message);
            },
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("does not exist") || message.contains("not found") || message.contains("invalid"),
                    "Error should indicate path doesn't exist, got: {}", message);
            },
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

        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].cwd, "/tmp");
            },
            ServerMessage::Error { message, .. } => panic!("Expected SessionList but got Error: {}", message),
            other => panic!("Expected SessionList, got {:?}", other),
        }
    }

    // === Task 2.4.2: WebSocket Origin Validation ===

    #[test]
    fn test_validate_origin_accepts_whitelisted() {
        assert!(validate_websocket_origin(Some("http://localhost:3000"), &[]));
    }

    #[test]
    fn test_validate_origin_rejects_unknown() {
        assert!(!validate_websocket_origin(Some("http://evil.example.com"), &[]));
    }

    #[test]
    fn test_validate_origin_accepts_custom_whitelist() {
        let custom = vec!["http://myapp.example.com".to_string()];
        assert!(validate_websocket_origin(Some("http://myapp.example.com"), &custom));
    }

    #[test]
    fn test_validate_origin_allows_no_origin_header() {
        // No origin header = likely not a browser, allow it
        assert!(validate_websocket_origin(None, &[]));
    }

    #[test]
    fn test_validate_origin_rejects_empty_origin() {
        assert!(!validate_websocket_origin(Some(""), &[]));
    }

    // === Task 8.2.1: Enhanced Metrics ===

    #[tokio::test]
    async fn test_messages_processed_total_increments() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Initially zero
        assert_eq!(
            state.messages_processed_total.load(std::sync::atomic::Ordering::Relaxed),
            0,
            "messages_processed_total should start at 0"
        );

        // Process a message
        process_message(&ClientMessage::ListSessions, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let _ = rx.recv().await; // consume response

        assert_eq!(
            state.messages_processed_total.load(std::sync::atomic::Ordering::Relaxed),
            1,
            "messages_processed_total should be 1 after one message"
        );

        // Process another message
        process_message(&ClientMessage::ListSessions, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let _ = rx.recv().await;

        assert_eq!(
            state.messages_processed_total.load(std::sync::atomic::Ordering::Relaxed),
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
            state.sessions_total.load(std::sync::atomic::Ordering::Relaxed),
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
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let _ = rx.recv().await;

        assert_eq!(
            state.sessions_total.load(std::sync::atomic::Ordering::Relaxed),
            1,
            "sessions_total should be 1 after creating one session"
        );
    }

    #[tokio::test]
    async fn test_sessions_active_gauge_reflects_current_sessions() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // No sessions yet
        assert_eq!(state.sessions.lock().len(), 0, "sessions_active should be 0 initially");

        // Create a session
        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        };
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        assert_eq!(state.sessions.lock().len(), 1, "sessions_active should be 1 after create");

        // Kill the session
        let kill_msg = ClientMessage::KillSession { session_id: id };
        process_message(&kill_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let _ = rx.recv().await; // SessionClosed
        let _ = rx.recv().await; // SessionList

        assert_eq!(state.sessions.lock().len(), 0, "sessions_active should be 0 after kill");
    }

    #[tokio::test]
    async fn test_history_bytes_gauge_per_session() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create a session
        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        };
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions[0].id.clone();

        // History should start empty
        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            let h = session.history.lock();
            assert_eq!(h.len(), 0, "History should be empty initially");
        }

        // Send input (mock PTY echoes it, which writes to history)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test data".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Give time for echo to be processed by reader thread
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // History should now have some bytes
        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            let h = session.history.lock();
            assert!(!h.is_empty(), "History should have bytes after input");
        }
    }

    #[tokio::test]
    async fn test_metrics_handler_includes_messages_processed() {
        let (state, _) = create_test_state();

        // Process a message to increment counter
        let (tx, mut rx) = mpsc::channel(32);
        let mut attach_tasks = handlers::io::AttachTasks::new();
        process_message(&ClientMessage::ListSessions, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let _ = rx.recv().await;

        // Call metrics handler
        let app = Router::new()
            .route("/metrics", get(metrics_handler))
            .with_state(state);

        let req = Request::builder().uri("/metrics").body(Body::empty()).unwrap();
        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), 10_000).await.unwrap();
        let body_str = String::from_utf8_lossy(&body);

        assert!(body_str.contains("messages_processed_total 1"),
            "Metrics should include messages_processed_total, got: {}", body_str);
        assert!(body_str.contains("sessions_active"), "Metrics should include sessions_active");
        assert!(body_str.contains("sessions_total_created"), "Metrics should include sessions_total_created");
        assert!(body_str.contains("session_broadcast_subscribers"), "Metrics should include broadcast subscribers");
    }

    #[tokio::test]
    async fn test_metrics_handler_includes_history_bytes() {
        let (state, _) = create_test_state();
        let (tx, mut rx) = mpsc::channel(32);

        let mut attach_tasks = handlers::io::AttachTasks::new();

        // Create a session so there's history to report
        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        };
        process_message(&msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let _ = rx.recv().await;

        // Call metrics handler
        let app = Router::new()
            .route("/metrics", get(metrics_handler))
            .with_state(state);

        let req = Request::builder().uri("/metrics").body(Body::empty()).unwrap();
        let response = app.oneshot(req).await.unwrap();
        let body = axum::body::to_bytes(response.into_body(), 10_000).await.unwrap();
        let body_str = String::from_utf8_lossy(&body);

        assert!(body_str.contains("history_bytes"),
            "Metrics should include history_bytes when sessions exist, got: {}", body_str);
    }

    #[tokio::test]
    async fn test_refresh_endpoint_issues_new_access_token() {
        let (state, _) = create_test_state();

        // Issue a refresh token
        let refresh = jwt::issue_refresh_token(
            &state.signing_key, "testuser", &state.server_id,
            Duration::from_secs(604800),
        ).unwrap();

        let app = Router::new()
            .route("/auth/refresh", post(refresh_handler))
            .with_state(state.clone());

        let req = Request::builder()
            .method("POST")
            .uri("/auth/refresh")
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_string(&serde_json::json!({"refresh_token": refresh})).unwrap()))
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), 10_000).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(json["access_token"].is_string());
        assert!(json["refresh_token"].is_string());
    }

    #[tokio::test]
    async fn test_refresh_endpoint_rejects_access_token() {
        let (state, _) = create_test_state();

        // Issue an access token (not refresh)
        let access = jwt::issue_access_token(
            &state.signing_key, "testuser", &state.server_id,
            Duration::from_secs(900),
        ).unwrap();

        let app = Router::new()
            .route("/auth/refresh", post(refresh_handler))
            .with_state(state.clone());

        let req = Request::builder()
            .method("POST")
            .uri("/auth/refresh")
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_string(&serde_json::json!({"refresh_token": access})).unwrap()))
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_refresh_endpoint_rejects_expired_token() {
        let (state, _) = create_test_state();

        // Issue an expired refresh token
        let past = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() - 7200;
        let expired = jwt::issue_token_for_test(
            &state.signing_key, "testuser", &state.server_id,
            past, Duration::from_secs(3600),
        ).unwrap();

        let app = Router::new()
            .route("/auth/refresh", post(refresh_handler))
            .with_state(state.clone());

        let req = Request::builder()
            .method("POST")
            .uri("/auth/refresh")
            .header("Content-Type", "application/json")
            .body(Body::from(serde_json::to_string(&serde_json::json!({"refresh_token": expired})).unwrap()))
            .unwrap();

        let response = app.oneshot(req).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    // ==================== F5a: Exited Session State Integration Tests ====================

    #[tokio::test]
    async fn test_input_to_exited_session_returns_error() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Transition session to Exited state
        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Exited).unwrap();
            }
        }

        // Try to send input to exited session
        process_message(
            &ClientMessage::Input { session_id: id.clone(), data: "hello".into() },
            &tx, &state.sessions, &state, &mut attach_tasks, "test"
        ).await.unwrap();

        // Should receive an Error message
        match rx.recv().await.unwrap() {
            ServerMessage::Error { message, .. } => {
                assert!(message.contains("not accepting"),
                    "Error should indicate session not accepting input, got: {}", message);
            },
            other => panic!("Expected Error message for exited session, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_exited_session_allows_attach() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Send some input (MockPty echoes)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test_data".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;

        // Transition session to Exited state
        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Exited).unwrap();
            }
        }

        // Attach to exited session - should succeed and get history
        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(&attach_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive Output with history (not an error)
        match rx.recv().await.unwrap() {
            ServerMessage::Output { session_id, data } => {
                assert_eq!(session_id, id);
                assert!(data.contains("test_data"), "Should contain history data");
            },
            other => panic!("Expected Output with history for exited session, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn test_kill_exited_session_transitions_to_closed() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Transition to Exited
        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Exited).unwrap();
            }
        }

        // Kill the exited session
        let kill_msg = ClientMessage::KillSession { session_id: id.clone() };
        process_message(&kill_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive SessionClosed
        match rx.recv().await.unwrap() {
            ServerMessage::SessionClosed { session_id } => assert_eq!(session_id, id),
            other => panic!("Expected SessionClosed, got {:?}", other),
        }

        // Session should be removed
        let guard = state.sessions.lock();
        assert!(!guard.contains_key(&id), "Exited session should be removed after kill");
    }

    #[tokio::test]
    async fn test_session_info_shows_exited_state() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Transition to Exited and set exit_code
        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.transition_to(SessionState::Exited).unwrap();
                session.exit_code = Some(0);
            }
        }

        // List sessions - should show exited state
        process_message(&ClientMessage::ListSessions, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].state, Some("exited".to_string()));
                assert_eq!(sessions[0].exit_code, Some(0));
            },
            other => panic!("Expected SessionList, got {:?}", other),
        }
    }

    // ==================== F3a: Activity Tracking Integration Tests ====================

    #[tokio::test]
    async fn test_activity_tracking_updates_last_output_at() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Initially last_output_at should be None
        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(session.last_output_at.lock().is_none(), "last_output_at should be None before any output");
        }

        // Send input (MockPty echoes, which triggers output and activity tracking)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "hello".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Wait for echo to be processed by the reader task
        tokio::time::sleep(Duration::from_millis(200)).await;

        // last_output_at should now be set
        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(session.last_output_at.lock().is_some(), "last_output_at should be set after output");
        }
    }

    #[tokio::test]
    async fn test_bell_detection_updates_last_bell_at() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Send input containing bell character (MockPty echoes)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "hello\x07world".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Wait for echo to be processed
        tokio::time::sleep(Duration::from_millis(200)).await;

        // last_bell_at should be set
        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(session.last_bell_at.lock().is_some(), "last_bell_at should be set after bell character");
        }
    }

    #[tokio::test]
    async fn test_bell_notification_sent_to_attached_client() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Attach
        let attach_msg = ClientMessage::Attach {
            session_id: id.clone(),
            mode: "mirror".to_string(),
        };
        process_message(&attach_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        // Drain history
        rx.recv().await.unwrap();

        // Send input with bell character
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "\x07".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Should receive bell notification and output
        let mut saw_bell = false;
        let mut saw_output = false;
        for _ in 0..5 {
            match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
                Ok(Some(ServerMessage::SessionActivity { activity_type, .. })) if activity_type == "bell" => {
                    saw_bell = true;
                },
                Ok(Some(ServerMessage::Output { .. })) => {
                    saw_output = true;
                },
                _ => break,
            }
            if saw_bell && saw_output {
                break;
            }
        }
        assert!(saw_bell, "Should have received bell notification");
    }

    #[tokio::test]
    async fn test_silence_notified_resets_on_output() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Manually set silence_notified to true
        {
            let mut guard = state.sessions.lock();
            if let Some(session) = guard.get_mut(&id) {
                session.silence_notified.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }

        // Send input (triggers output)
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();

        // Wait for output processing
        tokio::time::sleep(Duration::from_millis(200)).await;

        // silence_notified should be reset to false
        {
            let guard = state.sessions.lock();
            let session = guard.get(&id).unwrap();
            assert!(!session.silence_notified.load(std::sync::atomic::Ordering::Relaxed), "silence_notified should be reset after output");
        }
    }

    #[tokio::test]
    async fn test_session_info_includes_last_activity_at() {
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
        process_message(&create_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        let sessions_list = match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => sessions,
            _ => panic!("Expected SessionList"),
        };
        let id = sessions_list[0].id.clone();

        // Send input to trigger output
        let input_msg = ClientMessage::Input {
            session_id: id.clone(),
            data: "test".to_string(),
        };
        process_message(&input_msg, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;

        // List sessions - should include last_activity_at
        process_message(&ClientMessage::ListSessions, &tx, &state.sessions, &state, &mut attach_tasks, "test").await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::SessionList { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert!(sessions[0].last_activity_at.is_some(),
                    "last_activity_at should be present after output");
            },
            other => panic!("Expected SessionList, got {:?}", other),
        }
    }

    #[test]
    fn test_ws_auth_rate_limit_constant() {
        // Verify the rate limit constant is wired correctly
        assert_eq!(MAX_WS_AUTH_ATTEMPTS, 5);
        // The constant should match what's expected by the protocol
        assert!(MAX_WS_AUTH_ATTEMPTS > 0, "Must allow at least one attempt");
        assert!(MAX_WS_AUTH_ATTEMPTS <= 10, "Should not allow too many attempts");
    }

    #[test]
    fn test_extract_client_ip_trusted_proxy_matches() {
        let ip = extract_client_ip(
            Some("203.0.113.50, 70.41.3.18"),
            Some("10.0.0.1"),
            Some("10.0.0.1"),
        );
        assert_eq!(ip, "203.0.113.50");
    }

    #[test]
    fn test_extract_client_ip_trusted_proxy_no_match() {
        let ip = extract_client_ip(
            Some("203.0.113.50, 70.41.3.18"),
            Some("10.0.0.1"),
            Some("192.168.1.100"),
        );
        assert_eq!(ip, "192.168.1.100");
    }

    #[test]
    fn test_extract_client_ip_no_trusted_proxy() {
        // Without trusted proxy, XFF is used as fallback (backward compat)
        let ip = extract_client_ip(
            Some("203.0.113.50"),
            None,
            Some("192.168.1.100"),
        );
        assert_eq!(ip, "203.0.113.50");
    }

    #[test]
    fn test_extract_client_ip_no_trusted_proxy_no_xff() {
        // Without trusted proxy and no XFF, fall back to peer IP
        let ip = extract_client_ip(
            None,
            None,
            Some("192.168.1.100"),
        );
        assert_eq!(ip, "192.168.1.100");
    }

    #[test]
    fn test_extract_client_ip_no_xff_header() {
        let ip = extract_client_ip(
            None,
            Some("10.0.0.1"),
            Some("10.0.0.1"),
        );
        assert_eq!(ip, "10.0.0.1");
    }

    #[test]
    fn test_extract_client_ip_no_peer_ip() {
        let ip = extract_client_ip(None, None, None);
        assert_eq!(ip, "unknown");
    }

    #[test]
    fn test_extract_client_ip_single_xff() {
        let ip = extract_client_ip(
            Some("203.0.113.50"),
            Some("10.0.0.1"),
            Some("10.0.0.1"),
        );
        assert_eq!(ip, "203.0.113.50");
    }

    #[tokio::test]
    async fn test_http_redirect_to_https() {
        use axum::body::Body;
        use axum::http::Request as HttpRequest;
        use tower::ServiceExt;
        let app = build_http_redirect_router(8444);
        let response = app.clone().oneshot(
            HttpRequest::builder().uri("/ws").header("host", "example.com:3000")
                .body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
        let location = response.headers().get("location").unwrap().to_str().unwrap();
        assert_eq!(location, "https://example.com:8444/ws");
    }

    #[tokio::test]
    async fn test_http_redirect_standard_port() {
        use axum::body::Body;
        use axum::http::Request as HttpRequest;
        use tower::ServiceExt;
        let app = build_http_redirect_router(443);
        let response = app.clone().oneshot(
            HttpRequest::builder().uri("/test").header("host", "example.com")
                .body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
        let location = response.headers().get("location").unwrap().to_str().unwrap();
        assert_eq!(location, "https://example.com/test");
    }

    #[tokio::test]
    async fn test_http_redirect_health_still_works() {
        use axum::body::Body;
        use axum::http::Request as HttpRequest;
        use tower::ServiceExt;
        let app = build_http_redirect_router(8444);
        let response = app.clone().oneshot(
            HttpRequest::builder().uri("/health").body(Body::empty()).unwrap(),
        ).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    // === Task 17: --require-auth flag tests ===

    #[test]
    fn test_require_auth_skip_auth_logic() {
        // The skip_auth logic in handle_websocket is:
        //   let skip_auth = state.no_auth || (is_local && !state.require_auth);
        //
        // Truth table:
        //   no_auth=true,  is_local=*,     require_auth=*     -> skip (--no-auth always wins)
        //   no_auth=false, is_local=true,  require_auth=false -> skip (local default)
        //   no_auth=false, is_local=true,  require_auth=true  -> auth required
        //   no_auth=false, is_local=false, require_auth=*     -> auth required

        // Helper that mirrors the handle_websocket logic
        let skip_auth = |no_auth: bool, is_local: bool, require_auth: bool| -> bool {
            no_auth || (is_local && !require_auth)
        };

        // --no-auth always skips
        assert!(skip_auth(true, true, false));
        assert!(skip_auth(true, false, false));
        assert!(skip_auth(true, true, true));
        assert!(skip_auth(true, false, true));

        // Local without require_auth -> skip
        assert!(skip_auth(false, true, false));

        // Local WITH require_auth -> must auth
        assert!(!skip_auth(false, true, true));

        // Remote always requires auth (unless no_auth)
        assert!(!skip_auth(false, false, false));
        assert!(!skip_auth(false, false, true));
    }

    #[test]
    fn test_require_auth_in_app_state() {
        let (state, _) = create_test_state();
        // Default test state has require_auth = false
        assert!(!state.require_auth, "Default test state should have require_auth=false");
    }
}
