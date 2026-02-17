//! Unix socket integration tests for the termiNar server
//!
//! Tests session lifecycle via Unix socket (create, input, output, kill),
//! concurrent connections, large message handling, and reconnection.
//!
//! Run with: cargo test --test test_unix_socket -- --ignored

use terminar_server::config::Cli;
use terminar_server::run_server;
use terminar_server::messages::{ClientMessage, ServerMessage};
use tokio::net::UnixStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use std::time::Duration;
use std::collections::HashMap;

/// Helper: spawn a server with a unique Unix socket path and return the path + handle
async fn spawn_unix_server(name: &str) -> (String, u16, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let socket_path = format!("/tmp/test-unix-{}-{}.sock", name, port);

    // Clean up stale socket file
    let _ = std::fs::remove_file(&socket_path);

    let cli = Cli {
        command: None,
        port,
        socket: Some(socket_path.clone()),
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
    };

    let sp = socket_path.clone();
    let handle = tokio::spawn(async move {
        let _ = run_server(cli, &sp).await;
    });

    // Wait for server to start and create socket
    tokio::time::sleep(Duration::from_millis(800)).await;

    (socket_path, port, handle)
}

/// Helper: send a length-prefixed message over Unix socket
async fn send_message(stream: &mut UnixStream, msg: &ClientMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let bytes = json.as_bytes();
    let len = bytes.len() as u32;
    stream.write_all(&len.to_be_bytes()).await.unwrap();
    stream.write_all(bytes).await.unwrap();
}

/// Helper: read a length-prefixed message from Unix socket
async fn recv_message(stream: &mut UnixStream) -> Option<ServerMessage> {
    let mut len_buf = [0u8; 4];
    match tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut len_buf)).await {
        Ok(Ok(_)) => {}
        _ => return None,
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    let mut payload = vec![0u8; len];
    match tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut payload)).await {
        Ok(Ok(_)) => {}
        _ => return None,
    }
    let json = String::from_utf8(payload).ok()?;
    serde_json::from_str::<ServerMessage>(&json).ok()
}

/// Test full session lifecycle via Unix socket: create -> list -> attach -> input -> output -> kill
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_unix_socket_session_lifecycle() {
    let (socket_path, _port, _server) = spawn_unix_server("lifecycle").await;

    let mut stream = UnixStream::connect(&socket_path).await
        .expect("Failed to connect to Unix socket");

    // 1. Create a session
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    send_message(&mut stream, &create_msg).await;

    // 2. Should receive SessionList with the new session
    let response = recv_message(&mut stream).await
        .expect("Should receive response after create");
    let session_id = match &response {
        ServerMessage::SessionList { sessions } => {
            assert!(!sessions.is_empty(), "Session list should not be empty after create");
            sessions[0].id.clone()
        }
        other => panic!("Expected SessionList, got {:?}", other),
    };

    // 3. List sessions
    send_message(&mut stream, &ClientMessage::ListSessions).await;
    let response = recv_message(&mut stream).await
        .expect("Should receive session list");
    match &response {
        ServerMessage::SessionList { sessions } => {
            assert_eq!(sessions.len(), 1, "Should have exactly 1 session");
            assert_eq!(sessions[0].id, session_id);
        }
        other => panic!("Expected SessionList, got {:?}", other),
    }

    // 4. Attach to session
    let attach_msg = ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    };
    send_message(&mut stream, &attach_msg).await;

    // Should receive history output (empty for new mock session)
    let response = recv_message(&mut stream).await
        .expect("Should receive history output after attach");
    match &response {
        ServerMessage::Output { session_id: sid, .. } => {
            assert_eq!(sid, &session_id);
        }
        other => panic!("Expected Output (history), got {:?}", other),
    }

    // 5. Send input
    let input_msg = ClientMessage::Input {
        session_id: session_id.clone(),
        data: "hello".to_string(),
    };
    send_message(&mut stream, &input_msg).await;

    // 6. Should receive echoed output (mock PTY echoes input)
    let mut received = String::new();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) && received.len() < 5 {
        if let Some(ServerMessage::Output { data, .. }) = recv_message(&mut stream).await {
            received.push_str(&data);
        }
    }
    assert_eq!(received, "hello", "Mock PTY should echo input");

    // 7. Kill the session
    let kill_msg = ClientMessage::KillSession {
        session_id: session_id.clone(),
    };
    send_message(&mut stream, &kill_msg).await;

    // Should receive SessionClosed
    let mut got_closed = false;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(3) {
        if let Some(ServerMessage::SessionClosed { session_id: closed_id }) = recv_message(&mut stream).await {
            assert_eq!(closed_id, session_id);
            got_closed = true;
            break;
        }
    }
    assert!(got_closed, "Should receive SessionClosed after kill");

    // 8. Verify session list is now empty
    send_message(&mut stream, &ClientMessage::ListSessions).await;
    let response = recv_message(&mut stream).await
        .expect("Should receive session list");
    match &response {
        ServerMessage::SessionList { sessions } => {
            assert!(sessions.is_empty(), "Session list should be empty after kill");
        }
        other => panic!("Expected SessionList, got {:?}", other),
    }
}

/// Test concurrent connections to the same Unix socket
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_unix_socket_concurrent_connections() {
    let (socket_path, _port, _server) = spawn_unix_server("concurrent").await;

    let client_count = 5;
    let mut handles = vec![];

    for i in 0..client_count {
        let sp = socket_path.clone();
        handles.push(tokio::spawn(async move {
            let mut stream = UnixStream::connect(&sp).await
                .expect("Failed to connect to Unix socket");

            // Each client creates a session
            let create_msg = ClientMessage::CreateSession {
                cwd: "/".to_string(),
                shell: format!("client-{}", i),
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            };
            send_message(&mut stream, &create_msg).await;

            // Should receive response
            let response = recv_message(&mut stream).await;
            assert!(response.is_some(), "Client {} should receive a response", i);

            match response.unwrap() {
                ServerMessage::SessionList { sessions } => {
                    assert!(!sessions.is_empty(), "Client {} should see sessions", i);
                }
                ServerMessage::Error { message, .. } => {
                    // Shell validation will reject non-whitelisted shells
                    // That's acceptable - the server handled it gracefully
                    assert!(message.contains("whitelist"), "Expected whitelist error for client {}", i);
                }
                other => panic!("Client {} unexpected response: {:?}", i, other),
            }
        }));
    }

    for handle in handles {
        handle.await.expect("Client task should not panic");
    }
}

/// Test large message handling (>16KB)
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_unix_socket_large_message() {
    let (socket_path, _port, _server) = spawn_unix_server("large-msg").await;

    let mut stream = UnixStream::connect(&socket_path).await
        .expect("Failed to connect to Unix socket");

    // Create a session first
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    send_message(&mut stream, &create_msg).await;

    let response = recv_message(&mut stream).await
        .expect("Should receive session list");
    let session_id = match response {
        ServerMessage::SessionList { sessions } => sessions[0].id.clone(),
        other => panic!("Expected SessionList, got {:?}", other),
    };

    // Attach to session
    send_message(&mut stream, &ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    }).await;
    let _ = recv_message(&mut stream).await; // consume history

    // Send a large input (>16KB)
    let large_data = "X".repeat(20_000);
    let input_msg = ClientMessage::Input {
        session_id: session_id.clone(),
        data: large_data.clone(),
    };
    send_message(&mut stream, &input_msg).await;

    // Should receive output (mock PTY echoes)
    let mut total_received = 0usize;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(5) && total_received < large_data.len() {
        if let Some(msg) = recv_message(&mut stream).await {
            if let ServerMessage::Output { data, .. } = msg {
                total_received += data.len();
            }
        } else {
            break;
        }
    }

    assert!(
        total_received > 0,
        "Should receive some output for large message, got {} bytes",
        total_received
    );
}

/// Test reconnection after disconnect
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_unix_socket_reconnection() {
    let (socket_path, _port, _server) = spawn_unix_server("reconnect").await;

    // First connection: create a session
    let session_id;
    {
        let mut stream = UnixStream::connect(&socket_path).await
            .expect("Failed to connect first time");

        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: "/bin/bash".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        };
        send_message(&mut stream, &create_msg).await;

        let response = recv_message(&mut stream).await
            .expect("Should receive session list");
        session_id = match response {
            ServerMessage::SessionList { sessions } => sessions[0].id.clone(),
            other => panic!("Expected SessionList, got {:?}", other),
        };
    } // First connection dropped here

    tokio::time::sleep(Duration::from_millis(100)).await;

    // Second connection: should see the session still exists
    {
        let mut stream = UnixStream::connect(&socket_path).await
            .expect("Failed to reconnect");

        send_message(&mut stream, &ClientMessage::ListSessions).await;

        let response = recv_message(&mut stream).await
            .expect("Should receive session list on reconnect");
        match response {
            ServerMessage::SessionList { sessions } => {
                let found = sessions.iter().any(|s| s.id == session_id);
                assert!(found, "Session should persist after client disconnect and reconnect");
            }
            other => panic!("Expected SessionList, got {:?}", other),
        }
    }
}

/// Test rename session via Unix socket
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_unix_socket_rename_session() {
    let (socket_path, _port, _server) = spawn_unix_server("rename").await;

    let mut stream = UnixStream::connect(&socket_path).await
        .expect("Failed to connect");

    // Create session
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    send_message(&mut stream, &create_msg).await;

    let response = recv_message(&mut stream).await.unwrap();
    let session_id = match response {
        ServerMessage::SessionList { sessions } => sessions[0].id.clone(),
        other => panic!("Expected SessionList, got {:?}", other),
    };

    // Rename session
    let rename_msg = ClientMessage::RenameSession {
        session_id: session_id.clone(),
        new_name: "my-session".to_string(),
    };
    send_message(&mut stream, &rename_msg).await;

    // Wait briefly for rename to process
    tokio::time::sleep(Duration::from_millis(100)).await;

    // List sessions and verify name changed
    send_message(&mut stream, &ClientMessage::ListSessions).await;
    let response = recv_message(&mut stream).await.unwrap();
    match response {
        ServerMessage::SessionList { sessions } => {
            let session = sessions.iter().find(|s| s.id == session_id)
                .expect("Session should exist");
            assert_eq!(session.name, "my-session", "Session name should be updated");
        }
        other => panic!("Expected SessionList, got {:?}", other),
    }
}

/// Test resize via Unix socket
#[tokio::test]
#[ignore = "Integration test - requires server startup"]
async fn test_unix_socket_resize() {
    let (socket_path, _port, _server) = spawn_unix_server("resize").await;

    let mut stream = UnixStream::connect(&socket_path).await
        .expect("Failed to connect");

    // Create session
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    send_message(&mut stream, &create_msg).await;

    let response = recv_message(&mut stream).await.unwrap();
    let session_id = match response {
        ServerMessage::SessionList { sessions } => sessions[0].id.clone(),
        other => panic!("Expected SessionList, got {:?}", other),
    };

    // Resize session - should not crash or error
    let resize_msg = ClientMessage::Resize {
        session_id: session_id.clone(),
        cols: 120,
        rows: 40,
    };
    send_message(&mut stream, &resize_msg).await;

    // Verify server still responds
    tokio::time::sleep(Duration::from_millis(100)).await;
    send_message(&mut stream, &ClientMessage::ListSessions).await;
    let response = recv_message(&mut stream).await;
    assert!(response.is_some(), "Server should still respond after resize");
}
