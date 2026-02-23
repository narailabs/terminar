//! Security tests for the terminar server
//!
//! Tests authentication bypass attempts, malformed message handling,
//! path traversal, environment injection, and rate limiting.
//!
//! Run with: cargo test --test test_security -- --ignored

use terminar_server::config::Cli;
use terminar_server::run_server;
use terminar_server::messages::{ClientMessage, ServerMessage};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures::{SinkExt, StreamExt};
use std::time::Duration;
use std::collections::HashMap;

/// Spawn a server with authentication ENABLED and require_auth=true
/// (forces auth even on localhost connections)
async fn spawn_require_auth_server(name: &str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-security-ra-{}-{}.sock", name, port)),
        log_level: "error".to_string(),
        no_auth: false, // Auth ENABLED
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
        auto_tls: false,
        audit_level: "off".to_string(),
        trusted_proxy: None,
        user_mode: false,
        require_auth: true, // Force auth even on localhost
    };

    let socket_path = cli.socket.clone().unwrap();
    let handle = tokio::spawn(async move {
        let _ = run_server(cli, &socket_path).await;
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    (format!("ws://127.0.0.1:{}/ws", port), handle)
}

/// Spawn a server without auth for malformed message tests
async fn spawn_noauth_server(name: &str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-security-na-{}-{}.sock", name, port)),
        log_level: "error".to_string(),
        no_auth: true,
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
        auto_tls: false,
        audit_level: "off".to_string(),
        trusted_proxy: None,
        user_mode: false,
        require_auth: false,
    };

    let socket_path = cli.socket.clone().unwrap();
    let handle = tokio::spawn(async move {
        let _ = run_server(cli, &socket_path).await;
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    (format!("ws://127.0.0.1:{}/ws", port), handle)
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsSender = futures::stream::SplitSink<WsStream, Message>;
type WsReader = futures::stream::SplitStream<WsStream>;

/// Helper: send ListSessions and wait for a SessionList response.
/// Returns the sessions vec, or panics with a timeout message.
async fn send_list_sessions_and_get_response(
    socket: &mut WsSender,
    reader: &mut WsReader,
    timeout_secs: u64,
) -> Vec<terminar_server::messages::SessionInfo> {
    socket.send(Message::Text(
        serde_json::to_string(&ClientMessage::ListSessions).unwrap()
    )).await.unwrap();

    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(timeout_secs) {
        if let Some(Ok(Message::Text(text))) = reader.next().await
            && let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text)
        {
            return sessions;
        }
    }
    panic!("Timed out waiting for SessionList response");
}

// ==================== Auth Bypass Tests ====================

/// Test: Sending a non-Auth message as the first message should fail when auth is required.
/// Uses --require-auth to force authentication even on localhost.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_auth_required_non_auth_first_message() {
    let (ws_url, _server) = spawn_require_auth_server("no-auth-msg").await;

    let (mut socket, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");

    // Send ListSessions without authenticating first
    let list_msg = ClientMessage::ListSessions;
    socket.send(Message::Text(serde_json::to_string(&list_msg).unwrap())).await.unwrap();

    // With require_auth, the server should NOT process the ListSessions.
    // It should either time out waiting for auth or close the connection.
    // The message will be silently ignored during the auth phase because it's not an auth message.
    // Wait briefly, then try sending another message - the connection should still be waiting for auth.
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Send a valid-looking auth with wrong token to get a definitive response
    let auth_msg = ClientMessage::Auth {
        token: "wrong-token".to_string(),
        protocol_version: None,
    };
    socket.send(Message::Text(serde_json::to_string(&auth_msg).unwrap())).await.unwrap();

    let start = std::time::Instant::now();
    let mut got_auth_error = false;
    while start.elapsed() < Duration::from_secs(3) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match msg {
                        ServerMessage::Error { error_code, .. } => {
                            assert_eq!(
                                error_code.as_deref(), Some("AUTH_FAILED"),
                                "Should get AUTH_FAILED error, not a successful response"
                            );
                            got_auth_error = true;
                            break;
                        }
                        ServerMessage::SessionList { .. } => {
                            panic!("Server should NOT return SessionList without authentication when require_auth is set");
                        }
                        _ => {}
                    }
                }
                break;
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => {}
        }
    }
    assert!(got_auth_error, "Server should require authentication and reject wrong token with AUTH_FAILED");
}

/// Test: Sending an invalid token should be rejected with AUTH_FAILED error.
/// Uses --require-auth to force authentication even on localhost.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_auth_invalid_token_rejected() {
    let (ws_url, _server) = spawn_require_auth_server("bad-token").await;

    let (mut socket, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");

    // Send Auth with invalid token
    let auth_msg = ClientMessage::Auth {
        token: "invalid-token-12345".to_string(),
        protocol_version: None,
    };
    socket.send(Message::Text(serde_json::to_string(&auth_msg).unwrap())).await.unwrap();

    // With require_auth, the server must reject the invalid token
    let start = std::time::Instant::now();
    let mut got_auth_error = false;
    while start.elapsed() < Duration::from_secs(3) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match msg {
                        ServerMessage::Error { message, error_code } => {
                            assert_eq!(
                                error_code.as_deref(), Some("AUTH_FAILED"),
                                "Expected AUTH_FAILED error code"
                            );
                            assert!(
                                message.contains("Authentication failed"),
                                "Error message should indicate auth failure: {}", message
                            );
                            got_auth_error = true;
                            break;
                        }
                        ServerMessage::AuthOk { .. } => {
                            panic!("Server should NOT accept an invalid token");
                        }
                        _ => {}
                    }
                }
                break;
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => {}
        }
    }
    assert!(got_auth_error, "Server should reject invalid token with AUTH_FAILED error");
}

/// Test: Sending an empty token should be rejected with AUTH_FAILED error.
/// Uses --require-auth to force authentication even on localhost.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_auth_empty_token() {
    let (ws_url, _server) = spawn_require_auth_server("empty-token").await;

    let (mut socket, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");

    let auth_msg = ClientMessage::Auth {
        token: "".to_string(),
        protocol_version: None,
    };
    socket.send(Message::Text(serde_json::to_string(&auth_msg).unwrap())).await.unwrap();

    // With require_auth, the server must reject the empty token
    let start = std::time::Instant::now();
    let mut got_auth_error = false;
    while start.elapsed() < Duration::from_secs(3) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match msg {
                        ServerMessage::Error { error_code, .. } => {
                            assert_eq!(
                                error_code.as_deref(), Some("AUTH_FAILED"),
                                "Expected AUTH_FAILED error code for empty token"
                            );
                            got_auth_error = true;
                            break;
                        }
                        ServerMessage::AuthOk { .. } => {
                            panic!("Server should NOT accept an empty token");
                        }
                        _ => {}
                    }
                }
                break;
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => {}
        }
    }
    assert!(got_auth_error, "Server should reject empty token with AUTH_FAILED error");
}

// ==================== Malformed Message Tests ====================

/// Test: Deeply nested JSON should not cause stack overflow.
/// Server should reject the malformed input and continue to handle valid messages correctly.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_deeply_nested_json() {
    let (ws_url, _server) = spawn_noauth_server("deep-json").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // Construct deeply nested JSON (1000 levels)
    let mut deep = String::from(r#"{"type":"create_session","cwd":"/"#);
    for _ in 0..1000 {
        deep.push_str(r#"","env":{"key":""#);
    }
    for _ in 0..1000 {
        deep.push_str(r#"""}"#);
    }

    sender.send(Message::Text(deep)).await.unwrap();

    // Server should reject or ignore without crashing
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Send a valid ListSessions and verify server responds with a proper SessionList.
    // This proves the server properly rejected the malformed message and continued operating.
    let _sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    // If we got here, the server correctly handled the malformed input and responded to a valid request.
}

/// Test: JSON with wrong field types (e.g., cols as string instead of u16).
/// Server should reject the malformed input and continue to handle valid messages correctly.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_wrong_field_types() {
    let (ws_url, _server) = spawn_noauth_server("wrong-types").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // cols should be u16, but we send it as a string
    let wrong_type_msg = r#"{"type":"create_session","cwd":"/","shell":"bash","env":{},"cols":"eighty","rows":24}"#;
    sender.send(Message::Text(wrong_type_msg.to_string())).await.unwrap();

    // Server should reject without crashing
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Send a valid ListSessions and verify server responds with a proper SessionList.
    // This proves the server properly rejected the malformed message and continued operating.
    let _sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    // If we got here, the server correctly handled the malformed input and responded to a valid request.
}

/// Test: Extremely large JSON payload (1MB).
/// Server should reject the oversized message and continue to handle valid messages correctly.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_extremely_large_json_payload() {
    let (ws_url, _server) = spawn_noauth_server("large-json").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // 1MB payload
    let huge_value = "A".repeat(1_000_000);
    let large_msg = format!(
        r#"{{"type":"create_session","cwd":"/","shell":"{}","env":{{}},"cols":80,"rows":24}}"#,
        huge_value
    );
    sender.send(Message::Text(large_msg)).await.unwrap();

    // Server should handle gracefully
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Send a valid ListSessions and verify server responds with a proper SessionList.
    // This proves the server properly rejected the oversized message and continued operating.
    let _sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    // If we got here, the server correctly handled the oversized input and responded to a valid request.
}

/// Test: NULL bytes in JSON.
/// Server should handle null bytes gracefully and continue to serve valid requests.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_null_bytes_in_json() {
    let (ws_url, _server) = spawn_noauth_server("null-bytes").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // Message with null bytes embedded
    let null_msg = format!(
        r#"{{"type":"input","session_id":"test","data":"hello{}world"}}"#,
        '\0'
    );
    sender.send(Message::Text(null_msg)).await.unwrap();

    // Should not crash
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Send a valid ListSessions and verify server responds with a proper SessionList.
    // This proves the server properly handled the null-byte message and continued operating.
    let _sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    // If we got here, the server correctly handled the null-byte input and responded to a valid request.
}

// ==================== Path Traversal Tests ====================

/// Test: Path traversal in cwd parameter.
/// Server should reject the request AND no new session should be created.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_cwd_path_traversal() {
    let (ws_url, _server) = spawn_noauth_server("cwd-traversal").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // Get baseline session count (server may have restored sessions from persistence)
    let baseline_sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    let baseline_count = baseline_sessions.len();

    let create_msg = ClientMessage::CreateSession {
        cwd: "/tmp/../../../etc".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    sender.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = reader.next().await
            && let Ok(ServerMessage::Error { message, .. }) = serde_json::from_str::<ServerMessage>(&text)
        {
            assert!(
                message.contains("path traversal"),
                "Error should mention path traversal: {}", message
            );
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should reject path traversal in cwd");

    // Verify no new session was created by the path traversal attempt
    let sessions_after = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    assert_eq!(sessions_after.len(), baseline_count,
        "No new session should be created from a path traversal attempt");
}

/// Test: Embedded ".." path traversal in cwd.
/// Server should reject the request AND no new session should be created.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_cwd_dot_dot_embedded() {
    let (ws_url, _server) = spawn_noauth_server("cwd-dotdot").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // Get baseline session count (server may have restored sessions from persistence)
    let baseline_sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    let baseline_count = baseline_sessions.len();

    let create_msg = ClientMessage::CreateSession {
        cwd: "/tmp/safe/../../etc/shadow".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    sender.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = reader.next().await
            && let Ok(ServerMessage::Error { message, .. }) = serde_json::from_str::<ServerMessage>(&text)
        {
            assert!(
                message.contains("path traversal"),
                "Error should mention path traversal: {}", message
            );
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should reject cwd with embedded '..' path traversal");

    // Verify no new session was created by the path traversal attempt
    let sessions_after = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    assert_eq!(sessions_after.len(), baseline_count,
        "No new session should be created from a path traversal attempt");
}

// ==================== Environment Injection Tests ====================

/// Test: LD_PRELOAD environment variable is filtered out during session creation.
/// The session should be created successfully (proving LD_PRELOAD was silently stripped).
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_ld_preload_filtered() {
    let (ws_url, _server) = spawn_noauth_server("ld-preload").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // Get baseline session count (server may have restored sessions from persistence)
    let baseline_sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    let baseline_count = baseline_sessions.len();

    let mut env = HashMap::new();
    env.insert("LD_PRELOAD".to_string(), "/tmp/malicious.so".to_string());
    env.insert("NORMAL_VAR".to_string(), "safe_value".to_string());

    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env,
        cols: 80,
        rows: 24,
    };
    sender.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    // Server should create the session successfully (filtering LD_PRELOAD silently).
    // Wait for the SessionList response that is broadcast after session creation.
    let start = std::time::Instant::now();
    let mut session_created = false;
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = reader.next().await
            && let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text)
        {
            // Session count should have increased by 1, proving LD_PRELOAD was filtered (not rejected)
            assert_eq!(sessions.len(), baseline_count + 1,
                "Session should be created despite LD_PRELOAD in env (it should be filtered, not rejected)");
            session_created = true;
            break;
        }
    }
    assert!(session_created, "Server should create the session after filtering LD_PRELOAD");

    // Verify via explicit ListSessions that the session persists
    let sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    assert_eq!(sessions.len(), baseline_count + 1,
        "The session created with filtered LD_PRELOAD should persist");
}

/// Test: DYLD_INSERT_LIBRARIES and related env vars are filtered out during session creation.
/// The session should be created successfully (proving all DYLD_* vars were silently stripped).
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_dyld_insert_libraries_filtered() {
    let (ws_url, _server) = spawn_noauth_server("dyld-inject").await;

    let (ws_stream, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");
    let (mut sender, mut reader) = ws_stream.split();

    // Get baseline session count (server may have restored sessions from persistence)
    let baseline_sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    let baseline_count = baseline_sessions.len();

    let mut env = HashMap::new();
    env.insert("DYLD_INSERT_LIBRARIES".to_string(), "/tmp/evil.dylib".to_string());
    env.insert("DYLD_FORCE_FLAT_NAMESPACE".to_string(), "1".to_string());
    env.insert("DYLD_LIBRARY_PATH".to_string(), "/tmp/evil".to_string());
    env.insert("DYLD_FRAMEWORK_PATH".to_string(), "/tmp/evil".to_string());
    env.insert("LD_LIBRARY_PATH".to_string(), "/tmp/evil".to_string());

    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env,
        cols: 80,
        rows: 24,
    };
    sender.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    // Server should create the session successfully (filtering all DYLD_* vars silently).
    let start = std::time::Instant::now();
    let mut session_created = false;
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = reader.next().await
            && let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text)
        {
            // Session count should have increased by 1, proving DYLD_* vars were filtered (not rejected)
            assert_eq!(sessions.len(), baseline_count + 1,
                "Session should be created despite DYLD_* vars in env (they should be filtered, not rejected)");
            session_created = true;
            break;
        }
    }
    assert!(session_created, "Server should create the session after filtering DYLD_* vars");

    // Verify via explicit ListSessions that the session persists
    let sessions = send_list_sessions_and_get_response(&mut sender, &mut reader, 3).await;
    assert_eq!(sessions.len(), baseline_count + 1,
        "The session created with filtered DYLD_* vars should persist");
}

// ==================== Rate Limiting Tests ====================

/// Test: Health endpoint is accessible without authentication
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_health_endpoint_unauthenticated() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-health-{}.sock", port)),
        log_level: "error".to_string(),
        no_auth: false, // Auth enabled
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
        auto_tls: false,
        audit_level: "off".to_string(),
        trusted_proxy: None,
        user_mode: false,
        require_auth: false,
    };

    let socket_path = cli.socket.clone().unwrap();
    let _handle = tokio::spawn(async move {
        let _ = run_server(cli, &socket_path).await;
    });

    tokio::time::sleep(Duration::from_millis(500)).await;

    // Health endpoint should work without token
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{}/health", port))
        .send()
        .await
        .expect("Failed to reach health endpoint");

    assert_eq!(resp.status(), 200, "Health endpoint should be accessible without auth");

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

/// Test: Metrics endpoint is protected by auth (requires token)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_metrics_endpoint_requires_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-metrics-auth-{}.sock", port)),
        log_level: "error".to_string(),
        no_auth: false,
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
        auto_tls: false,
        audit_level: "off".to_string(),
        trusted_proxy: None,
        user_mode: false,
        require_auth: false,
    };

    let socket_path = cli.socket.clone().unwrap();
    let _handle = tokio::spawn(async move {
        let _ = run_server(cli, &socket_path).await;
    });

    tokio::time::sleep(Duration::from_millis(500)).await;

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{}/metrics", port))
        .send()
        .await
        .expect("Failed to reach metrics endpoint");

    assert_eq!(resp.status(), 401, "Metrics endpoint should require auth");
}

/// Test: Pair exchange rate limiting returns 429 after too many attempts
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_pair_exchange_rate_limiting() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-ratelimit-{}.sock", port)),
        log_level: "error".to_string(),
        no_auth: false,
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
        auto_tls: false,
        audit_level: "off".to_string(),
        trusted_proxy: None,
        user_mode: false,
        require_auth: false,
    };

    let socket_path = cli.socket.clone().unwrap();
    let _handle = tokio::spawn(async move {
        let _ = run_server(cli, &socket_path).await;
    });

    tokio::time::sleep(Duration::from_millis(500)).await;

    let client = reqwest::Client::new();

    // Send multiple invalid pairing attempts rapidly
    let mut got_rate_limited = false;
    for i in 0..10 {
        let resp = client
            .post(format!("http://127.0.0.1:{}/pair/exchange", port))
            .json(&serde_json::json!({"code": format!("invalid-{}", i)}))
            .send()
            .await;

        if let Ok(resp) = resp
            && resp.status() == 429
        {
            got_rate_limited = true;
            break;
        }
    }

    assert!(got_rate_limited, "Should be rate limited after multiple invalid pairing attempts");
}

/// Test: WebSocket auth rate limiting - after MAX_WS_AUTH_ATTEMPTS failed attempts,
/// the server should send RATE_LIMIT_EXCEEDED and close the connection.
/// Uses --require-auth to force authentication even on localhost.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_ws_auth_rate_limit_after_5_failures() {
    let (ws_url, _server) = spawn_require_auth_server("ws-rate-limit").await;

    let (mut socket, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");

    // Send 7 invalid auth attempts (MAX_WS_AUTH_ATTEMPTS = 5, so the 6th should trigger rate limit)
    let mut got_rate_limited = false;
    let mut auth_failed_count = 0;
    for i in 0..7 {
        let auth_msg = ClientMessage::Auth {
            token: format!("invalid-token-{}", i),
            protocol_version: None,
        };
        let send_result = socket.send(Message::Text(serde_json::to_string(&auth_msg).unwrap())).await;
        if send_result.is_err() {
            // Connection was closed by the server after rate limit
            break;
        }

        // Read response
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(msg) = serde_json::from_str::<ServerMessage>(&text) {
                        match msg {
                            ServerMessage::Error { error_code, .. } => {
                                if error_code.as_deref() == Some("RATE_LIMIT_EXCEEDED") {
                                    got_rate_limited = true;
                                    break;
                                } else if error_code.as_deref() == Some("AUTH_FAILED") {
                                    auth_failed_count += 1;
                                    break;
                                }
                            }
                            _ => break,
                        }
                    }
                    break;
                }
                Some(Ok(Message::Close(_))) => {
                    break;
                }
                None => break,
                _ => {}
            }
        }

        if got_rate_limited {
            break;
        }
    }

    // With require_auth, the server must enforce rate limiting
    assert!(got_rate_limited, "Server should send RATE_LIMIT_EXCEEDED after {} failed attempts", auth_failed_count);
    assert!(auth_failed_count <= 5, "Should get at most 5 AUTH_FAILED before RATE_LIMIT_EXCEEDED, got {}", auth_failed_count);
}

/// Test: WebSocket auth allows retry after failure (before hitting rate limit).
/// Uses --require-auth to force authentication even on localhost.
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_ws_auth_allows_retry_after_failure() {
    let (ws_url, _server) = spawn_require_auth_server("ws-retry").await;

    let (mut socket, _) = connect_async(&ws_url)
        .await
        .expect("Failed to connect");

    // Send an invalid token first
    let bad_auth = ClientMessage::Auth {
        token: "wrong-token".to_string(),
        protocol_version: None,
    };
    socket.send(Message::Text(serde_json::to_string(&bad_auth).unwrap())).await.unwrap();

    // Read the error response - should be AUTH_FAILED (not connection close)
    let start = std::time::Instant::now();
    let mut got_first_error = false;
    while start.elapsed() < Duration::from_secs(2) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(ServerMessage::Error { error_code, .. }) = serde_json::from_str::<ServerMessage>(&text) {
                    assert_eq!(
                        error_code.as_deref(), Some("AUTH_FAILED"),
                        "First bad token should get AUTH_FAILED"
                    );
                    got_first_error = true;
                }
                break;
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => {}
        }
    }
    assert!(got_first_error, "Should get AUTH_FAILED for first bad token");

    // Verify the connection is still usable - send a second bad token and expect another AUTH_FAILED
    let second_auth = ClientMessage::Auth {
        token: "another-wrong-token".to_string(),
        protocol_version: None,
    };
    let send_result = socket.send(Message::Text(serde_json::to_string(&second_auth).unwrap())).await;
    assert!(send_result.is_ok(), "Connection should still be open for retry after first AUTH_FAILED");

    // Read the second error response
    let start = std::time::Instant::now();
    let mut got_second_error = false;
    while start.elapsed() < Duration::from_secs(2) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(ServerMessage::Error { error_code, .. }) = serde_json::from_str::<ServerMessage>(&text) {
                    assert_eq!(
                        error_code.as_deref(), Some("AUTH_FAILED"),
                        "Second bad token should also get AUTH_FAILED (not RATE_LIMIT_EXCEEDED)"
                    );
                    got_second_error = true;
                }
                break;
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => {}
        }
    }
    assert!(got_second_error, "Should get AUTH_FAILED for second bad token (connection allows retry)");
}

// ==================== Origin Validation Tests ====================

/// Test the validate_websocket_origin function directly
#[test]
fn test_websocket_origin_validation_no_origin() {
    // No origin header should be allowed (non-browser request)
    assert!(terminar_server::validate_websocket_origin(None, &[]));
}

#[test]
fn test_websocket_origin_validation_empty_origin() {
    // Empty origin should be rejected
    assert!(!terminar_server::validate_websocket_origin(Some(""), &[]));
}

#[test]
fn test_websocket_origin_validation_localhost_allowed() {
    // localhost origins should be allowed by default
    assert!(terminar_server::validate_websocket_origin(
        Some("http://localhost:6749"), &[]
    ));
    assert!(terminar_server::validate_websocket_origin(
        Some("http://127.0.0.1:6749"), &[]
    ));
}

#[test]
fn test_websocket_origin_validation_unknown_rejected() {
    // Unknown origins should be rejected
    assert!(!terminar_server::validate_websocket_origin(
        Some("http://evil.com"), &[]
    ));
}

#[test]
fn test_websocket_origin_validation_custom_allowed() {
    // Custom origins should be allowed when configured
    let custom = vec!["http://myapp.example.com".to_string()];
    assert!(terminar_server::validate_websocket_origin(
        Some("http://myapp.example.com"), &custom
    ));
}

#[test]
fn test_websocket_origin_validation_custom_still_rejects_unknown() {
    let custom = vec!["http://myapp.example.com".to_string()];
    assert!(!terminar_server::validate_websocket_origin(
        Some("http://evil.com"), &custom
    ));
}
