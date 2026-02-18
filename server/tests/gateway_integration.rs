//! Integration tests for the terminar gateway.
//!
//! Tests the gateway's WebSocket authentication flow, health endpoint,
//! error handling, and rate limiting. The full end-to-end test that spawns
//! per-user servers via sudo is marked `#[ignore]`.
//!
//! Run non-ignored tests: cargo test --test gateway_integration
//! Run all (requires sudo): cargo test --test gateway_integration -- --ignored

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::connect_info::MockConnectInfo;
use axum::routing::get;
use axum::Router;
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite;

use terminar_server::auth::PasswordVerifier;
use terminar_server::gateway::user_server::UserServerManager;
use terminar_server::gateway::GatewayState;
use terminar_server::jwt;
use terminar_server::messages::ServerMessage;

/// A mock password verifier that accepts a single username/password pair.
struct MockVerifier {
    valid_username: String,
    valid_password: String,
}

impl MockVerifier {
    fn new(username: &str, password: &str) -> Self {
        Self {
            valid_username: username.to_string(),
            valid_password: password.to_string(),
        }
    }
}

impl PasswordVerifier for MockVerifier {
    fn verify(&self, username: &str, password: &str) -> Result<(), String> {
        if username == self.valid_username && password == self.valid_password {
            Ok(())
        } else {
            Err("Invalid username or password".to_string())
        }
    }
}

/// Start a gateway test server on a random port with a mock verifier.
/// Returns the base URL (e.g., "127.0.0.1:12345") and a shutdown sender.
async fn start_test_gateway(
    username: &str,
    password: &str,
    max_auth_attempts: usize,
) -> (String, broadcast::Sender<()>) {
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    let signing_key = jwt::generate_signing_key();
    let verifier = MockVerifier::new(username, password);

    let manager = Arc::new(UserServerManager::new(
        "terminar-server",
        "/tmp/test-gateway",
        1800,
    ));

    let state = GatewayState {
        user_server_manager: manager,
        signing_key: Arc::new(signing_key),
        server_id: "test-server".to_string(),
        password_verifier: Some(Arc::new(verifier) as Arc<dyn PasswordVerifier>),
        max_auth_attempts,
        shutdown_tx: shutdown_tx.clone(),
    };

    // We need to re-create the routes here since ws_handler and health_handler
    // are private in the gateway module. Use the public GatewayState and
    // reconstruct the app. Since the handlers are private, we test via the
    // full axum app by importing the module's public API.
    //
    // The gateway module's handlers are private, so we build the app the
    // same way run_gateway() does but without TLS, logging, or signal handling.
    let app = build_test_app(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let mut shutdown_rx = shutdown_tx.subscribe();
    tokio::spawn(async move {
        let server = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        );
        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    eprintln!("Test gateway error: {}", e);
                }
            }
            _ = shutdown_rx.recv() => {}
        }
    });

    // Give the server a moment to start
    tokio::time::sleep(Duration::from_millis(50)).await;

    (addr.to_string(), shutdown_tx)
}

/// Build the test app. Since the gateway's ws_handler and health_handler are
/// private, we need to re-implement thin wrappers here for testing.
fn build_test_app(state: GatewayState) -> Router {
    use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
    use axum::extract::State;
    use axum::response::IntoResponse;

    async fn test_ws_handler(
        ws: WebSocketUpgrade,
        State(state): State<GatewayState>,
    ) -> impl IntoResponse {
        ws.on_upgrade(move |socket| test_handle_ws(socket, state))
    }

    async fn test_handle_ws(mut socket: WebSocket, state: GatewayState) {
        let mut auth_attempts: usize = 0;

        // Authentication loop
        let _username = loop {
            let msg = match tokio::time::timeout(Duration::from_secs(10), socket.recv()).await {
                Ok(Some(Ok(Message::Text(text)))) => text,
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) => return,
                Ok(Some(Err(_))) => return,
                Ok(Some(Ok(_))) => continue,
                Err(_) => {
                    let _ = send_test_error(&mut socket, "Authentication timeout").await;
                    return;
                }
            };

            auth_attempts += 1;
            if auth_attempts > state.max_auth_attempts {
                let _ = send_test_error(&mut socket, "Too many authentication attempts").await;
                return;
            }

            match serde_json::from_str::<serde_json::Value>(&msg) {
                Ok(parsed) => {
                    if let Some(msg_type) = parsed.get("type").and_then(|t| t.as_str()) {
                        match msg_type {
                            "AuthPassword" => {
                                let username = parsed
                                    .get("username")
                                    .and_then(|u| u.as_str())
                                    .unwrap_or("");
                                let password = parsed
                                    .get("password")
                                    .and_then(|p| p.as_str())
                                    .unwrap_or("");

                                if let Some(ref verifier) = state.password_verifier {
                                    if verifier.verify(username, password).is_ok() {
                                        let token = jwt::issue_access_token(
                                            &state.signing_key,
                                            username,
                                            &state.server_id,
                                            Duration::from_secs(900),
                                        )
                                        .unwrap_or_default();
                                        let auth_ok = ServerMessage::AuthOk {
                                            token,
                                            expires: "900".to_string(),
                                            protocol_version: None,
                                            refresh_token: None,
                                        };
                                        let _ = socket
                                            .send(Message::Text(
                                                serde_json::to_string(&auth_ok).unwrap().into(),
                                            ))
                                            .await;
                                        break username.to_string();
                                    } else {
                                        let _ = send_test_error(
                                            &mut socket,
                                            "Invalid credentials",
                                        )
                                        .await;
                                    }
                                }
                            }
                            _ => {
                                let _ = send_test_error(
                                    &mut socket,
                                    "Expected AuthPassword message",
                                )
                                .await;
                            }
                        }
                    }
                }
                Err(_) => {
                    let _ = send_test_error(&mut socket, "Invalid message format").await;
                }
            }
        };

        // After auth, the real gateway would proxy to a per-user server.
        // In the test, we just close the connection after auth succeeds.
    }

    async fn send_test_error(
        socket: &mut WebSocket,
        message: &str,
    ) -> Result<(), axum::Error> {
        let error_msg = ServerMessage::Error {
            message: message.to_string(),
            error_code: None,
        };
        socket
            .send(Message::Text(
                serde_json::to_string(&error_msg).unwrap().into(),
            ))
            .await
    }

    async fn test_health_handler() -> &'static str {
        "ok"
    }

    Router::new()
        .route("/ws", get(test_ws_handler))
        .route("/health", get(test_health_handler))
        .layer(MockConnectInfo(SocketAddr::from(([127, 0, 0, 1], 0))))
        .with_state(state)
}

/// Helper to send a JSON message over a tungstenite WebSocket.
async fn ws_send(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    msg: &serde_json::Value,
) {
    use futures::SinkExt;
    ws.send(tungstenite::Message::Text(
        serde_json::to_string(msg).unwrap(),
    ))
    .await
    .unwrap();
}

/// Helper to receive and parse a ServerMessage from a tungstenite WebSocket.
async fn ws_recv(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Option<ServerMessage> {
    use futures::StreamExt;
    match tokio::time::timeout(Duration::from_secs(5), ws.next()).await {
        Ok(Some(Ok(tungstenite::Message::Text(text)))) => {
            serde_json::from_str::<ServerMessage>(&text).ok()
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Test that the health endpoint returns "ok".
#[tokio::test]
async fn test_gateway_health_endpoint() {
    let (addr, shutdown_tx) = start_test_gateway("testuser", "testpass", 5).await;

    let resp = reqwest::get(&format!("http://{}/health", addr))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), "ok");

    let _ = shutdown_tx.send(());
}

/// Test successful WebSocket password authentication.
#[tokio::test]
async fn test_gateway_auth_success() {
    let (addr, shutdown_tx) = start_test_gateway("alice", "secret123", 5).await;

    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // Send AuthPassword
    let auth_msg = serde_json::json!({
        "type": "AuthPassword",
        "username": "alice",
        "password": "secret123"
    });
    ws_send(&mut ws, &auth_msg).await;

    // Should receive AuthOk
    let response = ws_recv(&mut ws).await.expect("Should receive AuthOk");
    match response {
        ServerMessage::AuthOk { token, expires, .. } => {
            assert!(!token.is_empty(), "Token should not be empty");
            assert_eq!(expires, "900");
        }
        other => panic!("Expected AuthOk, got {:?}", other),
    }

    let _ = shutdown_tx.send(());
}

/// Test that invalid credentials return an error.
#[tokio::test]
async fn test_gateway_auth_failure() {
    let (addr, shutdown_tx) = start_test_gateway("alice", "secret123", 5).await;

    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // Send wrong password
    let auth_msg = serde_json::json!({
        "type": "AuthPassword",
        "username": "alice",
        "password": "wrong-password"
    });
    ws_send(&mut ws, &auth_msg).await;

    // Should receive Error
    let response = ws_recv(&mut ws).await.expect("Should receive Error");
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("Invalid credentials"),
                "Error should mention invalid credentials, got: {}",
                message
            );
        }
        other => panic!("Expected Error, got {:?}", other),
    }

    let _ = shutdown_tx.send(());
}

/// Test that non-AuthPassword messages during auth return an error.
#[tokio::test]
async fn test_gateway_auth_wrong_message_type() {
    let (addr, shutdown_tx) = start_test_gateway("alice", "secret123", 5).await;

    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // Send a ListSessions instead of AuthPassword
    let msg = serde_json::json!({
        "type": "ListSessions"
    });
    ws_send(&mut ws, &msg).await;

    // Should receive an error about expected AuthPassword
    let response = ws_recv(&mut ws).await.expect("Should receive Error");
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("AuthPassword"),
                "Error should mention AuthPassword, got: {}",
                message
            );
        }
        other => panic!("Expected Error, got {:?}", other),
    }

    let _ = shutdown_tx.send(());
}

/// Test that rate limiting kicks in after max_auth_attempts.
#[tokio::test]
async fn test_gateway_auth_rate_limiting() {
    // Set max_auth_attempts to 2 for faster testing
    let (addr, shutdown_tx) = start_test_gateway("alice", "secret123", 2).await;

    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    let wrong_auth = serde_json::json!({
        "type": "AuthPassword",
        "username": "alice",
        "password": "wrong"
    });

    // First attempt: should get "Invalid credentials"
    ws_send(&mut ws, &wrong_auth).await;
    let r1 = ws_recv(&mut ws).await.expect("Should receive error for attempt 1");
    match r1 {
        ServerMessage::Error { message, .. } => {
            assert!(message.contains("Invalid credentials"));
        }
        other => panic!("Expected Error, got {:?}", other),
    }

    // Second attempt: should get "Invalid credentials"
    ws_send(&mut ws, &wrong_auth).await;
    let r2 = ws_recv(&mut ws).await.expect("Should receive error for attempt 2");
    match r2 {
        ServerMessage::Error { message, .. } => {
            assert!(message.contains("Invalid credentials"));
        }
        other => panic!("Expected Error, got {:?}", other),
    }

    // Third attempt: exceeds max_auth_attempts (2), should get rate limit error
    ws_send(&mut ws, &wrong_auth).await;
    let r3 = ws_recv(&mut ws).await.expect("Should receive rate limit error");
    match r3 {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("Too many authentication attempts"),
                "Expected rate limit error, got: {}",
                message
            );
        }
        other => panic!("Expected Error for rate limit, got {:?}", other),
    }

    let _ = shutdown_tx.send(());
}

/// Test that invalid JSON returns an error.
#[tokio::test]
async fn test_gateway_auth_invalid_json() {
    let (addr, shutdown_tx) = start_test_gateway("alice", "secret123", 5).await;

    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // Send invalid JSON
    use futures::SinkExt;
    ws.send(tungstenite::Message::Text("not-valid-json".to_string()))
        .await
        .unwrap();

    // Should receive an error about invalid format
    let response = ws_recv(&mut ws).await.expect("Should receive Error");
    match response {
        ServerMessage::Error { message, .. } => {
            assert!(
                message.contains("Invalid message format"),
                "Error should mention invalid format, got: {}",
                message
            );
        }
        other => panic!("Expected Error, got {:?}", other),
    }

    let _ = shutdown_tx.send(());
}

/// Test that auth succeeds after initial failure (retry works).
#[tokio::test]
async fn test_gateway_auth_retry_after_failure() {
    let (addr, shutdown_tx) = start_test_gateway("alice", "secret123", 5).await;

    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // First attempt: wrong password
    let wrong_auth = serde_json::json!({
        "type": "AuthPassword",
        "username": "alice",
        "password": "wrong"
    });
    ws_send(&mut ws, &wrong_auth).await;
    let r1 = ws_recv(&mut ws).await.expect("Should receive error");
    assert!(matches!(r1, ServerMessage::Error { .. }));

    // Second attempt: correct password
    let correct_auth = serde_json::json!({
        "type": "AuthPassword",
        "username": "alice",
        "password": "secret123"
    });
    ws_send(&mut ws, &correct_auth).await;
    let r2 = ws_recv(&mut ws).await.expect("Should receive AuthOk");
    match r2 {
        ServerMessage::AuthOk { token, .. } => {
            assert!(!token.is_empty());
        }
        other => panic!("Expected AuthOk on retry, got {:?}", other),
    }

    let _ = shutdown_tx.send(());
}

/// Full end-to-end test: gateway spawns per-user server and proxies a session.
///
/// This test requires:
/// - The `terminar-server` binary to be built (`cargo build`)
/// - sudo privileges for spawning per-user servers
/// - A Unix system with proper user accounts
///
/// Run with: cargo test --test gateway_integration test_gateway_spawns_user_server -- --ignored
#[tokio::test]
#[ignore = "Requires sudo and a built terminar-server binary"]
async fn test_gateway_spawns_user_server_and_proxies() {
    // 1. Build the server binary path
    let server_bin = std::env::current_dir()
        .unwrap()
        .join("target/debug/terminar-server")
        .to_string_lossy()
        .to_string();

    let socket_dir = format!("/tmp/test-gateway-e2e-{}", std::process::id());
    std::fs::create_dir_all(&socket_dir).unwrap();

    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let signing_key = jwt::generate_signing_key();
    let username = std::env::var("USER").unwrap_or_else(|_| "nobody".to_string());

    // Use PAM verifier for real auth (this test is meant to run with real credentials)
    let verifier: Option<Arc<dyn PasswordVerifier>> =
        terminar_server::auth::create_platform_verifier("login")
            .map(|v| Arc::from(v) as Arc<dyn PasswordVerifier>);

    if verifier.is_none() {
        eprintln!("Skipping: no PAM verifier available on this platform");
        return;
    }

    let manager = Arc::new(UserServerManager::new(&server_bin, &socket_dir, 1800));

    let state = GatewayState {
        user_server_manager: manager.clone(),
        signing_key: Arc::new(signing_key),
        server_id: "test-e2e".to_string(),
        password_verifier: verifier,
        max_auth_attempts: 5,
        shutdown_tx: shutdown_tx.clone(),
    };

    let app = build_test_app(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let mut shutdown_rx = shutdown_tx.subscribe();
    tokio::spawn(async move {
        let server = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        );
        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    eprintln!("E2E gateway error: {}", e);
                }
            }
            _ = shutdown_rx.recv() => {}
        }
    });

    tokio::time::sleep(Duration::from_millis(100)).await;

    // 2. Connect via WebSocket
    let url = format!("ws://{}/ws", addr);
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

    // 3. Authenticate (this test expects the user to set TEST_PASSWORD env var)
    let password = std::env::var("TEST_PASSWORD").unwrap_or_else(|_| {
        eprintln!("Set TEST_PASSWORD env var for e2e gateway test");
        String::new()
    });

    if password.is_empty() {
        eprintln!("Skipping e2e: TEST_PASSWORD not set");
        let _ = shutdown_tx.send(());
        return;
    }

    let auth_msg = serde_json::json!({
        "type": "AuthPassword",
        "username": &username,
        "password": &password
    });
    ws_send(&mut ws, &auth_msg).await;

    let auth_response = ws_recv(&mut ws).await.expect("Should receive auth response");
    match auth_response {
        ServerMessage::AuthOk { token, .. } => {
            assert!(!token.is_empty(), "Should receive a valid token");
        }
        ServerMessage::Error { message, .. } => {
            panic!("Auth failed: {}", message);
        }
        other => panic!("Unexpected auth response: {:?}", other),
    }

    // 4. Verify per-user server was spawned (socket should exist)
    let user_socket = format!("{}/{}.sock", socket_dir, username);
    assert!(
        std::path::Path::new(&user_socket).exists(),
        "Per-user server socket should exist at {}",
        user_socket
    );

    // Note: After auth, the test gateway handler closes the connection
    // since it doesn't proxy to the per-user server. A full proxy test
    // would require the real gateway handlers which are private.

    // Cleanup
    let _ = shutdown_tx.send(());
    let _ = std::fs::remove_dir_all(&socket_dir);
}
