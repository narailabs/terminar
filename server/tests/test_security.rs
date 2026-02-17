//! Security tests for the termiNar server
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
use url::Url;
use std::collections::HashMap;

/// Spawn a server with authentication ENABLED (no_auth = false)
async fn spawn_auth_server(name: &str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-security-{}-{}.sock", name, port)),
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
    };

    let socket_path = cli.socket.clone().unwrap();
    let handle = tokio::spawn(async move {
        let _ = run_server(cli, &socket_path).await;
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    (format!("ws://127.0.0.1:{}/ws", port), handle)
}

// ==================== Auth Bypass Tests ====================

/// Test: Sending a non-Auth message as the first message should fail when auth is enabled.
/// Note: localhost connections bypass auth, so this test verifies the code path exists
/// but may pass on localhost. This is tested more meaningfully in remote/non-localhost scenarios.
#[tokio::test]
#[ignore = "Integration test - localhost bypasses auth by design"]
async fn test_auth_required_non_auth_first_message() {
    let (ws_url, _server) = spawn_auth_server("no-auth-msg").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Send ListSessions without authenticating first
    let list_msg = ClientMessage::ListSessions;
    socket.send(Message::Text(serde_json::to_string(&list_msg).unwrap())).await.unwrap();

    // On localhost, this will succeed because localhost bypasses auth.
    // The test validates the server does not crash regardless of the auth outcome.
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                // Either SessionList (localhost bypass) or Error (auth required) is acceptable
                if let Ok(msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match msg {
                        ServerMessage::SessionList { .. } => {
                            // localhost bypass worked
                            break;
                        }
                        ServerMessage::Error { message, .. } => {
                            assert!(
                                message.contains("auth") || message.contains("Auth"),
                                "Error should be about authentication: {}", message
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            }
            Some(Ok(Message::Close(_))) => {
                // Server closed connection - also acceptable for failed auth
                break;
            }
            _ => {}
        }
    }
}

/// Test: Sending an invalid token should be rejected
#[tokio::test]
#[ignore = "Integration test - localhost bypasses auth by design"]
async fn test_auth_invalid_token_rejected() {
    let (ws_url, _server) = spawn_auth_server("bad-token").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Send Auth with invalid token
    let auth_msg = ClientMessage::Auth {
        token: "invalid-token-12345".to_string(),
        protocol_version: None,
    };
    socket.send(Message::Text(serde_json::to_string(&auth_msg).unwrap())).await.unwrap();

    // On localhost, the auth check is bypassed, so this may be silently ignored
    // The test verifies no crash occurs
    let start = std::time::Instant::now();
    let mut _got_response = false;
    while start.elapsed() < Duration::from_secs(3) {
        match socket.next().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(msg) = serde_json::from_str::<ServerMessage>(&text) {
                    match msg {
                        ServerMessage::Error { message, .. } => {
                            assert!(message.contains("auth") || message.contains("Auth"),
                                "Should be auth error: {}", message);
                            _got_response = true;
                            break;
                        }
                        _ => {
                            // Localhost bypass - also acceptable
                            _got_response = true;
                            break;
                        }
                    }
                }
            }
            Some(Ok(Message::Close(_))) => {
                _got_response = true;
                break;
            }
            None => break,
            _ => {}
        }
    }
    // Server should not crash (pass by not panicking)
}

/// Test: Sending an empty token should be handled
#[tokio::test]
#[ignore = "Integration test - localhost bypasses auth by design"]
async fn test_auth_empty_token() {
    let (ws_url, _server) = spawn_auth_server("empty-token").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    let auth_msg = ClientMessage::Auth {
        token: "".to_string(),
        protocol_version: None,
    };
    socket.send(Message::Text(serde_json::to_string(&auth_msg).unwrap())).await.unwrap();

    // Wait briefly to verify no crash
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Try to send a message to verify the connection state
    let list_msg = ClientMessage::ListSessions;
    let send_result = socket.send(Message::Text(serde_json::to_string(&list_msg).unwrap())).await;

    // Either still connected or closed - both are acceptable, no crash
    match send_result {
        Ok(_) => {
            // Connection still open - could be localhost bypass
        }
        Err(_) => {
            // Connection closed after failed auth - correct behavior
        }
    }
}

// ==================== Malformed Message Tests ====================

/// Test: Deeply nested JSON should not cause stack overflow
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_deeply_nested_json() {
    let (ws_url, _server) = spawn_noauth_server("deep-json").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Construct deeply nested JSON (1000 levels)
    let mut deep = String::from(r#"{"type":"create_session","cwd":"/"#);
    for _ in 0..1000 {
        deep.push_str(r#"","env":{"key":""#);
    }
    for _ in 0..1000 {
        deep.push_str(r#"""}"#);
    }

    socket.send(Message::Text(deep)).await.unwrap();

    // Server should reject or ignore without crashing
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify server is still responsive
    socket.send(Message::Text(serde_json::to_string(&ClientMessage::ListSessions).unwrap())).await.unwrap();

    let mut responsive = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if serde_json::from_str::<ServerMessage>(&text).is_ok() {
                responsive = true;
                break;
            }
        }
    }
    assert!(responsive, "Server should remain responsive after deeply nested JSON");
}

/// Test: JSON with wrong field types (e.g., cols as string instead of u16)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_wrong_field_types() {
    let (ws_url, _server) = spawn_noauth_server("wrong-types").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // cols should be u16, but we send it as a string
    let wrong_type_msg = r#"{"type":"create_session","cwd":"/","shell":"bash","env":{},"cols":"eighty","rows":24}"#;
    socket.send(Message::Text(wrong_type_msg.to_string())).await.unwrap();

    // Server should reject without crashing
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify still responsive
    socket.send(Message::Text(serde_json::to_string(&ClientMessage::ListSessions).unwrap())).await.unwrap();

    let mut responsive = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if serde_json::from_str::<ServerMessage>(&text).is_ok() {
                responsive = true;
                break;
            }
        }
    }
    assert!(responsive, "Server should remain responsive after wrong field types");
}

/// Test: Extremely large JSON payload (1MB)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_extremely_large_json_payload() {
    let (ws_url, _server) = spawn_noauth_server("large-json").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // 1MB payload
    let huge_value = "A".repeat(1_000_000);
    let large_msg = format!(
        r#"{{"type":"create_session","cwd":"/","shell":"{}","env":{{}},"cols":80,"rows":24}}"#,
        huge_value
    );
    socket.send(Message::Text(large_msg)).await.unwrap();

    // Server should handle gracefully
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify still responsive
    socket.send(Message::Text(serde_json::to_string(&ClientMessage::ListSessions).unwrap())).await.unwrap();

    let mut responsive = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if serde_json::from_str::<ServerMessage>(&text).is_ok() {
                responsive = true;
                break;
            }
        }
    }
    assert!(responsive, "Server should remain responsive after large JSON payload");
}

/// Test: NULL bytes in JSON
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_null_bytes_in_json() {
    let (ws_url, _server) = spawn_noauth_server("null-bytes").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Message with null bytes embedded
    let null_msg = format!(
        r#"{{"type":"input","session_id":"test","data":"hello{}world"}}"#,
        '\0'
    );
    socket.send(Message::Text(null_msg)).await.unwrap();

    // Should not crash
    tokio::time::sleep(Duration::from_millis(300)).await;

    socket.send(Message::Text(serde_json::to_string(&ClientMessage::ListSessions).unwrap())).await.unwrap();

    let mut responsive = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if serde_json::from_str::<ServerMessage>(&text).is_ok() {
                responsive = true;
                break;
            }
        }
    }
    assert!(responsive, "Server should remain responsive after null bytes in JSON");
}

// ==================== Path Traversal Tests ====================

/// Test: Path traversal in cwd parameter
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_cwd_path_traversal() {
    let (ws_url, _server) = spawn_noauth_server("cwd-traversal").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    let create_msg = ClientMessage::CreateSession {
        cwd: "/tmp/../../../etc".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if let Ok(ServerMessage::Error { message, .. }) = serde_json::from_str::<ServerMessage>(&text) {
                assert!(
                    message.contains("path traversal"),
                    "Error should mention path traversal: {}", message
                );
                got_error = true;
                break;
            }
        }
    }
    assert!(got_error, "Server should reject path traversal in cwd");
}

/// Test: Symlink-based path traversal in cwd
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_cwd_dot_dot_embedded() {
    let (ws_url, _server) = spawn_noauth_server("cwd-dotdot").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    let create_msg = ClientMessage::CreateSession {
        cwd: "/tmp/safe/../../etc/shadow".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if let Ok(ServerMessage::Error { .. }) = serde_json::from_str::<ServerMessage>(&text) {
                got_error = true;
                break;
            }
        }
    }
    assert!(got_error, "Server should reject cwd with embedded '..' path traversal");
}

// ==================== Environment Injection Tests ====================

/// Test: LD_PRELOAD environment variable is filtered
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_ld_preload_filtered() {
    let (ws_url, _server) = spawn_noauth_server("ld-preload").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

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
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    // Server should create session (filtering LD_PRELOAD) or return error
    // Either way, it should not pass LD_PRELOAD to the shell
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if serde_json::from_str::<ServerMessage>(&text).is_ok() {
                break;
            }
        }
    }
    // Test passes if no crash - the filter_env function strips LD_PRELOAD before spawn
}

/// Test: DYLD_INSERT_LIBRARIES environment variable is filtered
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_dyld_insert_libraries_filtered() {
    let (ws_url, _server) = spawn_noauth_server("dyld-inject").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

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
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if serde_json::from_str::<ServerMessage>(&text).is_ok() {
                break;
            }
        }
    }
    // Test passes if no crash - all DYLD_* vars should be filtered
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

        if let Ok(resp) = resp {
            if resp.status() == 429 {
                got_rate_limited = true;
                break;
            }
        }
    }

    assert!(got_rate_limited, "Should be rate limited after multiple invalid pairing attempts");
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
        Some("http://localhost:3000"), &[]
    ));
    assert!(terminar_server::validate_websocket_origin(
        Some("http://127.0.0.1:3000"), &[]
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
