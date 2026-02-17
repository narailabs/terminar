//! Multi-user gateway for termiNar.
//!
//! The gateway is a reverse proxy that:
//! 1. Terminates TLS and authenticates clients (password or SSH key)
//! 2. Spawns per-user terminar-server instances via `sudo -u <username>`
//! 3. Proxies authenticated WebSocket connections to the user's server
//! 4. Manages idle timeouts and server lifecycle

pub mod config;
pub mod proxy;
pub mod user_server;

use config::GatewayConfig;
use user_server::UserServerManager;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use tokio::sync::broadcast;
use tracing::{error, info, warn};

use crate::auth;
use crate::jwt;
use crate::messages::ServerMessage;
use crate::security_headers;
use crate::tls;

/// Shared state for the gateway handlers.
#[derive(Clone)]
pub struct GatewayState {
    pub user_server_manager: Arc<UserServerManager>,
    pub signing_key: Arc<Vec<u8>>,
    pub server_id: String,
    pub password_verifier: Option<Arc<dyn auth::PasswordVerifier>>,
    pub max_auth_attempts: usize,
    pub shutdown_tx: broadcast::Sender<()>,
}

/// Run the gateway with the given configuration.
///
/// This is the main entry point called from `server/src/bin/gateway.rs`.
pub async fn run_gateway(config: GatewayConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| config.log_level.clone().into()),
        )
        .init();

    info!(
        port = config.port,
        tls_port = config.tls_port,
        server_bin = %config.server_bin,
        socket_dir = %config.socket_dir,
        idle_timeout = config.idle_timeout,
        "termiNar gateway starting"
    );

    // Create shutdown broadcast channel
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    // Load or create JWT signing key
    let home_dir = std::path::PathBuf::from(
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()),
    );
    let key_path = home_dir.join(".terminar").join("gateway.key");
    let signing_key = jwt::load_or_create_signing_key(&key_path).unwrap_or_else(|e| {
        warn!(
            "Failed to load/create signing key: {}, generating ephemeral key",
            e
        );
        jwt::generate_signing_key()
    });
    let server_id = uuid::Uuid::new_v4().to_string();

    // Create password verifier for authenticating users
    let password_verifier: Option<Arc<dyn auth::PasswordVerifier>> =
        auth::create_platform_verifier("login")
            .map(|v| Arc::from(v) as Arc<dyn auth::PasswordVerifier>);

    // Create per-user server manager
    let user_server_manager = Arc::new(UserServerManager::new(
        &config.server_bin,
        &config.socket_dir,
        config.idle_timeout,
    ));

    // Resolve TLS configuration
    let tls_dir = home_dir.join(".terminar").join("tls");
    let tls_config = tls::resolve_tls_config(
        config.tls_cert.as_deref(),
        config.tls_key.as_deref(),
        config.tls_port,
        config.auto_tls,
        &tls_dir,
    )?;

    let tls_enabled = tls_config.is_some();
    let security_headers_state = security_headers::SecurityHeadersState { tls_enabled };

    let state = GatewayState {
        user_server_manager: user_server_manager.clone(),
        signing_key: Arc::new(signing_key),
        server_id,
        password_verifier,
        max_auth_attempts: config.max_auth_attempts,
        shutdown_tx: shutdown_tx.clone(),
    };

    // Build router
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health_handler))
        .layer(axum::middleware::from_fn_with_state(
            security_headers_state,
            security_headers::security_headers_middleware,
        ))
        .with_state(state);

    // Start HTTP listener
    let addr = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Gateway listening on http://{}", addr);

    // Start TLS listener if configured
    let tls_task = if let Some(ref tls_cfg) = tls_config {
        info!("Gateway TLS listening on https://0.0.0.0:{}", tls_cfg.port);
        let tls_shutdown = shutdown_tx.subscribe();
        Some(
            tls::spawn_tls_server(tls_cfg, app.clone(), tls_shutdown)
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?,
        )
    } else {
        None
    };

    // Spawn idle server cleanup task
    let idle_manager = user_server_manager.clone();
    let mut idle_shutdown_rx = shutdown_tx.subscribe();
    let idle_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    idle_manager.shutdown_idle_servers().await;
                }
                _ = idle_shutdown_rx.recv() => {
                    info!("Idle server cleanup task shutting down");
                    break;
                }
            }
        }
    });

    // Serve HTTP
    let mut server_shutdown_rx = shutdown_tx.subscribe();
    let server_task = tokio::spawn(async move {
        let server = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        );
        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    error!("Gateway server error: {}", e);
                }
            }
            _ = server_shutdown_rx.recv() => {
                info!("Gateway HTTP server received shutdown signal");
            }
        }
    });

    // Wait for shutdown signal (SIGTERM or SIGINT)
    tokio::signal::ctrl_c().await?;
    info!("Shutdown signal received, stopping gateway...");
    let _ = shutdown_tx.send(());

    // Wait for tasks to finish
    let _ = server_task.await;
    if let Some(task) = tls_task {
        let _ = task.await;
    }
    let _ = idle_task.await;

    info!("Gateway stopped");
    Ok(())
}

/// Health check response.
#[derive(serde::Serialize)]
struct HealthResponse {
    status: &'static str,
    active_servers: usize,
    version: &'static str,
}

/// Health check endpoint.
async fn health_handler(State(state): State<GatewayState>) -> Json<HealthResponse> {
    let active_servers = state.user_server_manager.active_server_count().await;
    Json(HealthResponse {
        status: "ok",
        active_servers,
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// WebSocket upgrade handler.
///
/// Authenticates the client, resolves their per-user server, then proxies
/// the connection bidirectionally.
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<GatewayState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    info!("Gateway WebSocket connection from {}", addr);
    ws.on_upgrade(move |socket| handle_gateway_websocket(socket, state))
}

/// Handle an authenticated and proxied WebSocket connection.
///
/// 1. Authenticate via message-based auth (password or SSH key)
/// 2. Extract username from JWT claims
/// 3. Ensure per-user server is running
/// 4. Proxy WebSocket to per-user server via Unix socket
async fn handle_gateway_websocket(mut socket: WebSocket, state: GatewayState) {
    let mut auth_attempts: usize = 0;

    // Authentication loop: wait for valid credentials
    let username = loop {
        let msg = match tokio::time::timeout(Duration::from_secs(30), socket.recv()).await {
            Ok(Some(Ok(Message::Text(text)))) => text,
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => {
                info!("Gateway WebSocket closed during auth");
                return;
            }
            Ok(Some(Err(e))) => {
                warn!("Gateway WebSocket error during auth: {}", e);
                return;
            }
            Ok(Some(Ok(_))) => continue, // Ignore non-text messages
            Err(_) => {
                warn!("Gateway WebSocket auth timeout");
                let _ = send_error(&mut socket, "Authentication timeout").await;
                return;
            }
        };

        auth_attempts += 1;
        if auth_attempts > state.max_auth_attempts {
            warn!("Gateway auth rate limit exceeded ({} attempts)", auth_attempts);
            let _ = send_error(&mut socket, "Too many authentication attempts").await;
            return;
        }

        // Try to parse as a client message for auth
        match serde_json::from_str::<serde_json::Value>(&msg) {
            Ok(msg) => {
                if let Some(msg_type) = msg.get("type").and_then(|t| t.as_str()) {
                    match msg_type {
                        // TODO: Add SSH public key auth support. Currently only password auth (PAM) is
                        // supported through the gateway. The design doc specifies PAM + SSH key auth.
                        "AuthPassword" => {
                            let username = msg
                                .get("username")
                                .and_then(|u| u.as_str())
                                .unwrap_or("");
                            let password = msg
                                .get("password")
                                .and_then(|p| p.as_str())
                                .unwrap_or("");

                            if let Some(ref verifier) = state.password_verifier {
                                if verifier.verify(username, password).is_ok() {
                                    info!("Gateway auth success for user: {}", username);
                                    let token = jwt::issue_access_token(
                                        &state.signing_key,
                                        username,
                                        &state.server_id,
                                        Duration::from_secs(900),
                                    )
                                    .unwrap_or_default();
                                    let auth_ok = ServerMessage::AuthOk {
                                        token: token.clone(),
                                        expires: "900".to_string(),
                                        protocol_version: None,
                                        refresh_token: None,
                                    };
                                    let _ = socket
                                        .send(Message::Text(
                                            serde_json::to_string(&auth_ok).unwrap(),
                                        ))
                                        .await;
                                    break username.to_string();
                                } else {
                                    warn!("Gateway auth failed for user: {}", username);
                                    let _ = send_error(&mut socket, "Invalid credentials").await;
                                }
                            } else {
                                let _ = send_error(
                                    &mut socket,
                                    "Password authentication not available",
                                )
                                .await;
                            }
                        }
                        _ => {
                            let _ = send_error(
                                &mut socket,
                                "Expected AuthPassword message during authentication",
                            )
                            .await;
                        }
                    }
                }
            }
            Err(_) => {
                let _ = send_error(&mut socket, "Invalid message format").await;
            }
        }
    };

    // Ensure per-user server is running
    let socket_path = match state.user_server_manager.ensure_server(&username).await {
        Ok(path) => path,
        Err(e) => {
            error!("Failed to ensure server for user {}: {}", username, e);
            let _ = send_error(&mut socket, &format!("Failed to start server: {}", e)).await;
            return;
        }
    };

    // Proxy the connection to the per-user server
    info!(
        "Proxying connection for user {} to {}",
        username, socket_path
    );
    if let Err(e) = proxy::proxy_websocket(socket, &socket_path).await {
        error!(
            "Proxy error for user {}: {}",
            username, e
        );
    }
}

/// Send an error message over the WebSocket.
async fn send_error(
    socket: &mut WebSocket,
    message: &str,
) -> Result<(), axum::Error> {
    let error_msg = ServerMessage::Error {
        message: message.to_string(),
        error_code: None,
    };
    socket
        .send(Message::Text(
            serde_json::to_string(&error_msg).unwrap(),
        ))
        .await
}
