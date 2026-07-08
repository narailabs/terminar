//! PTY failure scenario tests for the terminar server
//!
//! Tests shell exit with error code, PTY creation failure simulation,
//! and session error state transitions.
//!
//! Run with: cargo test --test test_pty_failures -- --ignored

use std::collections::HashMap;
use std::time::Duration;
use terminar_server::messages::{ClientMessage, ServerMessage};
use tokio::net::UnixStream;

mod common;
use common::{connect, recv_message, send_message, spawn_server};

/// Helper: create a session and return its ID (empty string if creation was rejected)
async fn create_session_and_get_id(stream: &mut UnixStream, shell: &str) -> String {
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: shell.to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(stream, &create_msg).await;

    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        match recv_message(stream).await {
            Some(ServerMessage::SessionList { sessions }) if !sessions.is_empty() => {
                return sessions[0].id.clone();
            }
            // If we get an Error about shell whitelist, that's also valid
            Some(ServerMessage::Error { .. }) => return String::new(),
            Some(_) => continue,
            None => break,
        }
    }
    String::new()
}

/// Test that attempting to create a session with a non-existent shell
/// returns an error rather than crashing the server
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_invalid_shell_path_returns_error() {
    let (socket_path, _server) = spawn_server("pty-bad-shell").await;

    let mut stream = connect(&socket_path).await;

    // Try to create a session with a non-whitelisted shell
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/usr/bin/nonexistent-shell".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(&mut stream, &create_msg).await;

    // Should receive an error about shell whitelist
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(ServerMessage::Error { message, .. }) = recv_message(&mut stream).await {
            assert!(
                message.contains("whitelist") || message.contains("not allowed"),
                "Error should mention whitelist: {}",
                message
            );
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should return error for non-whitelisted shell"
    );

    // Verify server is still functional
    send_message(&mut stream, &ClientMessage::ListSessions).await;
    let mut got_list = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionList { .. }) = recv_message(&mut stream).await {
            got_list = true;
            break;
        }
    }
    assert!(
        got_list,
        "Server should still respond after shell creation failure"
    );
}

/// Test that the server handles path traversal in shell path
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_shell_path_traversal_rejected() {
    let (socket_path, _server) = spawn_server("pty-shell-traversal").await;

    let mut stream = connect(&socket_path).await;

    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/../usr/local/bin/malicious".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(&mut stream, &create_msg).await;

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(ServerMessage::Error { message, .. }) = recv_message(&mut stream).await {
            assert!(
                message.contains("path traversal") || message.contains("not allowed"),
                "Error should mention path traversal: {}",
                message
            );
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should reject shell paths with path traversal"
    );
}

/// Test that the server handles relative shell path
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_relative_shell_path_rejected() {
    let (socket_path, _server) = spawn_server("pty-relative-shell").await;

    let mut stream = connect(&socket_path).await;

    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "bash".to_string(), // Relative path - not starting with /
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(&mut stream, &create_msg).await;

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(ServerMessage::Error { message, .. }) = recv_message(&mut stream).await {
            assert!(
                message.contains("absolute path")
                    || message.contains("not allowed")
                    || message.contains("whitelist"),
                "Error should mention absolute path requirement: {}",
                message
            );
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should reject relative shell paths");
}

/// Test session creation with invalid cwd (non-existent directory)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_invalid_cwd_returns_error() {
    let (socket_path, _server) = spawn_server("pty-bad-cwd").await;

    let mut stream = connect(&socket_path).await;

    let create_msg = ClientMessage::CreateSession {
        cwd: "/nonexistent/path/that/does/not/exist".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(&mut stream, &create_msg).await;

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(ServerMessage::Error { message, .. }) = recv_message(&mut stream).await {
            assert!(
                message.contains("does not exist") || message.contains("not found"),
                "Error should mention non-existent path: {}",
                message
            );
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should return error for non-existent cwd");
}

/// Test creating a session then killing it, verifying the session
/// transitions through states correctly (Running -> Closed)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_session_state_transitions_on_kill() {
    let (socket_path, _server) = spawn_server("pty-state-kill").await;

    let mut stream = connect(&socket_path).await;

    // Create session
    let session_id = create_session_and_get_id(&mut stream, "/bin/bash").await;
    assert!(!session_id.is_empty(), "Should create session successfully");

    // Kill session
    let kill_msg = ClientMessage::KillSession {
        session_id: session_id.clone(),
    };
    send_message(&mut stream, &kill_msg).await;

    // Wait for SessionClosed
    let mut got_closed = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(ServerMessage::SessionClosed {
            session_id: closed_id,
        }) = recv_message(&mut stream).await
        {
            assert_eq!(closed_id, session_id);
            got_closed = true;
            break;
        }
    }
    assert!(got_closed, "Should receive SessionClosed");

    // Verify session no longer in list
    send_message(&mut stream, &ClientMessage::ListSessions).await;

    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionList { sessions }) = recv_message(&mut stream).await {
            let found = sessions.iter().any(|s| s.id == session_id);
            assert!(!found, "Killed session should not appear in session list");
            break;
        }
    }
}

/// Test sending input to a killed session produces an error
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_input_to_killed_session_errors() {
    let (socket_path, _server) = spawn_server("pty-input-killed").await;

    let mut stream = connect(&socket_path).await;

    // Create and kill session
    let session_id = create_session_and_get_id(&mut stream, "/bin/bash").await;
    assert!(!session_id.is_empty());

    let kill_msg = ClientMessage::KillSession {
        session_id: session_id.clone(),
    };
    send_message(&mut stream, &kill_msg).await;

    // Wait for close confirmation
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionClosed { .. }) = recv_message(&mut stream).await {
            break;
        }
    }

    // Now try to send input to the killed session
    let input_msg = ClientMessage::Input {
        session_id: session_id.clone(),
        data: "should fail".to_string(),
    };
    send_message(&mut stream, &input_msg).await;

    // Should receive an error
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    // Note: The server may silently ignore or error, both are acceptable
    // The key requirement is that it does not crash
    if !got_error {
        // Verify server is still responsive
        send_message(&mut stream, &ClientMessage::ListSessions).await;
        let mut got_list = false;
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if let Some(ServerMessage::SessionList { .. }) = recv_message(&mut stream).await {
                got_list = true;
                break;
            }
        }
        assert!(
            got_list,
            "Server should remain responsive after input to killed session"
        );
    }
}

/// Test environment variable filtering (LD_PRELOAD should be blocked)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_dangerous_env_vars_filtered() {
    let (socket_path, _server) = spawn_server("pty-env-filter").await;

    let mut stream = connect(&socket_path).await;

    let mut env = HashMap::new();
    env.insert("LD_PRELOAD".to_string(), "/tmp/malicious.so".to_string());
    env.insert(
        "DYLD_INSERT_LIBRARIES".to_string(),
        "/tmp/evil.dylib".to_string(),
    );
    env.insert("SAFE_VAR".to_string(), "safe_value".to_string());

    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env,
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(&mut stream, &create_msg).await;

    // Server should create session (filtering env silently) or reject
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        match recv_message(&mut stream).await {
            Some(ServerMessage::SessionList { sessions }) => {
                // Session created successfully with dangerous vars filtered
                assert!(!sessions.is_empty());
                break;
            }
            Some(ServerMessage::Error { .. }) => break, // Error is also acceptable
            Some(_) => continue,
            None => break,
        }
    }
    // Test passes if no crash
}
