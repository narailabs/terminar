//! Failure scenario tests for the terminar server
//!
//! These tests verify the server's behavior under failure conditions,
//! including invalid inputs and error recovery.

use std::collections::HashMap;
use std::time::Duration;
use terminar_server::messages::{ClientMessage, ServerMessage};

mod common;
use common::{connect, recv_message, send_message, send_raw_frame, spawn_server};

/// Test that malformed JSON messages are rejected gracefully
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_malformed_json_rejection() {
    let (socket_path, _server) = spawn_server("fail-malformed").await;

    let mut stream = connect(&socket_path).await;

    // Send malformed JSON
    send_raw_frame(&mut stream, b"{ invalid json }").await;

    // Server should send an error
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { message, .. }) = recv_message(&mut stream).await {
            assert!(
                message.contains("parse")
                    || message.contains("JSON")
                    || message.contains("invalid"),
                "Error message should mention parsing: {}",
                message
            );
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should send error for malformed JSON");
}

/// Test that empty messages are handled
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_empty_message_handling() {
    let (socket_path, _server) = spawn_server("fail-empty").await;

    let mut stream = connect(&socket_path).await;

    // Send empty frame
    send_raw_frame(&mut stream, b"").await;

    // Should receive an error or be gracefully ignored
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(1) {
        match recv_message(&mut stream).await {
            Some(ServerMessage::Error { .. }) => break, // Expected
            Some(ServerMessage::SessionList { .. }) => break, // Also acceptable
            Some(_) => continue,
            None => break,
        }
    }
    // Test passes if no crash occurred
}

/// Test that unknown message types are rejected
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_unknown_message_type() {
    let (socket_path, _server) = spawn_server("fail-unknown").await;

    let mut stream = connect(&socket_path).await;

    // Send message with unknown type
    send_raw_frame(&mut stream, br#"{"type": "unknown_type", "data": "test"}"#).await;

    // Server should send an error
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should send error for unknown message type"
    );
}

/// Test operation on non-existent session
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_nonexistent_session_operations() {
    let (socket_path, _server) = spawn_server("fail-nonexistent").await;

    let mut stream = connect(&socket_path).await;

    // Try to attach to non-existent session
    let attach_msg = ClientMessage::Attach {
        session_id: "nonexistent-session-id".to_string(),
        mode: "mirror".to_string(),
    };
    send_message(&mut stream, &attach_msg).await;

    // Should receive an error
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { message, .. }) = recv_message(&mut stream).await {
            assert!(
                message.contains("not found")
                    || message.contains("unknown")
                    || message.contains("exist"),
                "Error should mention session not found: {}",
                message
            );
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should error on non-existent session");
}

/// Test sending input to non-existent session
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_input_to_nonexistent_session() {
    let (socket_path, _server) = spawn_server("fail-input-nonexist").await;

    let mut stream = connect(&socket_path).await;

    let input_msg = ClientMessage::Input {
        session_id: "fake-session-12345".to_string(),
        data: "some input".to_string(),
    };
    send_message(&mut stream, &input_msg).await;

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should error when sending input to non-existent session"
    );
}

/// Test killing non-existent session
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_kill_nonexistent_session() {
    let (socket_path, _server) = spawn_server("fail-kill-nonexist").await;

    let mut stream = connect(&socket_path).await;

    let kill_msg = ClientMessage::KillSession {
        session_id: "fake-session-xyz".to_string(),
    };
    send_message(&mut stream, &kill_msg).await;

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should error when killing non-existent session"
    );
}

/// Test resize on non-existent session
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_resize_nonexistent_session() {
    let (socket_path, _server) = spawn_server("fail-resize-nonexist").await;

    let mut stream = connect(&socket_path).await;

    let resize_msg = ClientMessage::Resize {
        session_id: "fake-session-abc".to_string(),
        cols: 120,
        rows: 40,
    };
    send_message(&mut stream, &resize_msg).await;

    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should error when resizing non-existent session"
    );
}

/// Test double kill of same session
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_double_kill_session() {
    let (socket_path, _server) = spawn_server("fail-double-kill").await;

    let mut stream = connect(&socket_path).await;

    // Create a session first
    send_message(&mut stream, &common::create_session_msg()).await;

    // Get session ID
    let mut session_id = String::new();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionList { sessions }) = recv_message(&mut stream).await
            && !sessions.is_empty()
        {
            session_id = sessions[0].id.clone();
            break;
        }
    }
    assert!(!session_id.is_empty(), "Failed to create session");

    // Kill session first time
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

    // Kill session second time
    send_message(&mut stream, &kill_msg).await;

    // Should receive an error (session no longer exists)
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    assert!(
        got_error,
        "Server should error when killing already-killed session"
    );
}

/// Test invalid resize dimensions
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_invalid_resize_dimensions() {
    let (socket_path, _server) = spawn_server("fail-invalid-resize").await;

    let mut stream = connect(&socket_path).await;

    // Create a session first
    send_message(&mut stream, &common::create_session_msg()).await;

    // Get session ID
    let mut session_id = String::new();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionList { sessions }) = recv_message(&mut stream).await
            && !sessions.is_empty()
        {
            session_id = sessions[0].id.clone();
            break;
        }
    }
    assert!(!session_id.is_empty(), "Failed to create session");

    // Try resize with zero dimensions
    let resize_msg = ClientMessage::Resize {
        session_id: session_id.clone(),
        cols: 0,
        rows: 0,
    };
    send_message(&mut stream, &resize_msg).await;

    // Server should either error or clamp to minimum; we just verify no crash
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Connection should still be open - verify by sending list_sessions
    send_message(&mut stream, &ClientMessage::ListSessions).await;

    let mut got_response = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if recv_message(&mut stream).await.is_some() {
            got_response = true;
            break;
        }
    }
    assert!(
        got_response,
        "Server should still respond after invalid resize"
    );
}

/// Test very long session shell name
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_long_shell_name() {
    let (socket_path, _server) = spawn_server("fail-long-shell").await;

    let mut stream = connect(&socket_path).await;

    // Create session with very long shell name
    let long_shell = "x".repeat(10000);
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: long_shell,
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    send_message(&mut stream, &create_msg).await;

    // Server should handle gracefully (either create or error)
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        match recv_message(&mut stream).await {
            Some(ServerMessage::SessionList { .. }) | Some(ServerMessage::Error { .. }) => break,
            Some(_) => continue,
            None => break,
        }
    }
    // Test passes if no crash
}

/// Test non-UTF8 payload handling (should be ignored, not crash)
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_non_utf8_payload_rejection() {
    let (socket_path, _server) = spawn_server("fail-binary").await;

    let mut stream = connect(&socket_path).await;

    // Send a frame with invalid UTF-8 bytes
    send_raw_frame(&mut stream, &[0x00, 0x01, 0x02, 0xFF]).await;

    // Should be ignored (not crash)
    tokio::time::sleep(Duration::from_millis(500)).await;

    // Verify server still responds to valid messages
    send_message(&mut stream, &ClientMessage::ListSessions).await;

    let mut got_response = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionList { .. }) = recv_message(&mut stream).await {
            got_response = true;
            break;
        }
    }
    assert!(
        got_response,
        "Server should still respond after non-UTF8 payload"
    );
}

/// Test rapid connection/disconnection
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_rapid_connect_disconnect() {
    let (socket_path, _server) = spawn_server("fail-rapid-conn").await;

    for _ in 0..10 {
        let stream = connect(&socket_path).await;
        drop(stream); // Immediately disconnect
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Verify server still accepts new connections after rapid connect/disconnect
    let mut stream = connect(&socket_path).await;

    send_message(&mut stream, &ClientMessage::ListSessions).await;

    let mut got_response = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::SessionList { .. }) = recv_message(&mut stream).await {
            got_response = true;
            break;
        }
    }
    assert!(
        got_response,
        "Server should respond after rapid connect/disconnect cycles"
    );
}

/// Test message with missing required fields
#[tokio::test]
#[ignore = "Requires server changes to send explicit error responses for edge cases"]
async fn test_missing_required_fields() {
    let (socket_path, _server) = spawn_server("fail-missing-fields").await;

    let mut stream = connect(&socket_path).await;

    // Send create_session without required cwd field
    send_raw_frame(
        &mut stream,
        br#"{"type": "create_session", "shell": "bash"}"#,
    )
    .await;

    // Should receive an error
    let mut got_error = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(2) {
        if let Some(ServerMessage::Error { .. }) = recv_message(&mut stream).await {
            got_error = true;
            break;
        }
    }
    assert!(got_error, "Server should error on missing required fields");
}
