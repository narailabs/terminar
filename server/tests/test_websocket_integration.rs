use terminar_server::config::Cli;
use terminar_server::run_server;
use terminar_server::messages::{ClientMessage, ServerMessage};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures::{SinkExt, StreamExt};
use std::time::Duration;
use url::Url;
use std::collections::HashMap;
use serial_test::serial;

// Helper to spawn server on random port
async fn spawn_test_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-server-{}.sock", port)),
        log_level: "error".to_string(),
        no_auth: true,
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        persist_sessions: false,
        session_file: None,
        compress_history: false,
        persist_history: false,
        history_dir: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
    };

    let socket_path = cli.socket.clone().unwrap();
    
    let handle = tokio::spawn(async move {
        run_server(cli, &socket_path).await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    (format!("ws://127.0.0.1:{}/ws", port), handle)
}

#[tokio::test]
#[serial]
async fn test_websocket_flow_full() {
    let (ws_url, _server_handle) = spawn_test_server().await;
    
    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // 1. Create Session
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    let msg = socket.next().await.unwrap().unwrap();
    let mut session_id = String::new();
    
    if let Message::Text(text) = msg {
        let resp: ServerMessage = serde_json::from_str(&text).unwrap();
        if let ServerMessage::SessionList { sessions } = resp {
            assert_eq!(sessions.len(), 1);
            session_id = sessions[0].id.clone();
        } else {
            panic!("Expected SessionList");
        }
    }

    assert!(!session_id.is_empty());

    // 2. Attach
    let attach_msg = ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    };
    socket.send(Message::Text(serde_json::to_string(&attach_msg).unwrap())).await.unwrap();

    // Expect history output (empty for new mock session)
    let msg = socket.next().await.unwrap().unwrap();
    if let Message::Text(text) = msg {
        let resp: ServerMessage = serde_json::from_str(&text).unwrap();
        if let ServerMessage::Output { session_id: sid, data } = resp {
            assert_eq!(sid, session_id);
            assert!(data.is_empty());
        } else {
            panic!("Expected Output (History)");
        }
    }

    // 3. Input
    let input_msg = ClientMessage::Input {
        session_id: session_id.clone(),
        data: "hello".to_string(),
    };
    socket.send(Message::Text(serde_json::to_string(&input_msg).unwrap())).await.unwrap();

    // Expect echo back (5 bytes for 'hello')
    // Note: MockPty echoes byte-by-byte or chunks. 
    // We loop until we get 5 bytes total.
    let mut received = String::new();
    while received.len() < 5 {
        let msg = socket.next().await.unwrap().unwrap();
        if let Message::Text(text) = msg {
            let resp: ServerMessage = serde_json::from_str(&text).unwrap();
            if let ServerMessage::Output { data, .. } = resp {
                received.push_str(&data);
            }
        }
    }
    assert_eq!(received, "hello");
}

// Helper to spawn server with auth enabled (no_auth=false)
async fn spawn_test_server_with_auth() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-server-auth-{}.sock", port)),
        log_level: "error".to_string(),
        no_auth: false, // Auth ENABLED - but localhost should still skip it
        mock_pty: true,
        cors_origins: vec![],
        log_json: false,
        log_file: None,
        persist_sessions: false,
        session_file: None,
        compress_history: false,
        persist_history: false,
        history_dir: None,
        tls_cert: None,
        tls_key: None,
        tls_port: 8444,
        max_auth_attempts: 5,
    };

    let socket_path = cli.socket.clone().unwrap();

    let handle = tokio::spawn(async move {
        run_server(cli, &socket_path).await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    (format!("ws://127.0.0.1:{}/ws", port), handle)
}

/// Test that localhost connections skip auth even when auth is enabled.
/// This is the Phase 1 local-first auth improvement.
#[tokio::test]
#[serial]
async fn test_localhost_connection_skips_auth() {
    let (ws_url, _server_handle) = spawn_test_server_with_auth().await;

    // Connect from localhost without sending auth message
    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Don't send Auth message - just send ListSessions directly
    // If localhost auth bypass works, we should get a SessionList response
    let list_msg = ClientMessage::ListSessions;
    socket.send(Message::Text(serde_json::to_string(&list_msg).unwrap())).await.unwrap();

    // Wait for response with timeout
    let msg = tokio::time::timeout(
        Duration::from_secs(5),
        socket.next()
    ).await.expect("Timeout waiting for response")
     .expect("Connection closed")
     .expect("Failed to receive message");

    if let Message::Text(text) = msg {
        let resp: ServerMessage = serde_json::from_str(&text).unwrap();
        match resp {
            ServerMessage::SessionList { sessions } => {
                // Success! Localhost connection skipped auth
                assert_eq!(sessions.len(), 0, "Expected empty session list");
            },
            ServerMessage::Error { message } => {
                panic!("Got auth error, localhost bypass not working: {}", message);
            },
            _ => {
                panic!("Unexpected response: {:?}", resp);
            }
        }
    } else {
        panic!("Expected text message");
    }
}
