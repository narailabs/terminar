//! Stress tests for the termiNar server
//!
//! These tests verify the server's behavior under high load conditions.
//! Run with: cargo test --test test_stress -- --ignored

use terminar_server::config::Cli;
use terminar_server::run_server;
use terminar_server::messages::{ClientMessage, ServerMessage};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures::{SinkExt, StreamExt};
use std::time::{Duration, Instant};
use url::Url;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

async fn spawn_stress_server(name: &str) -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        command: None,
        port,
        socket: Some(format!("/tmp/test-stress-{}-{}.sock", name, port)),
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

/// Test creating and deleting 100 sessions rapidly
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_100_concurrent_sessions() {
    let (ws_url, _server) = spawn_stress_server("100sessions").await;
    let session_count = 100;
    let created = Arc::new(AtomicUsize::new(0));
    let mut handles = vec![];

    // Create sessions concurrently
    for i in 0..session_count {
        let url = ws_url.clone();
        let created_count = created.clone();

        handles.push(tokio::spawn(async move {
            let (mut socket, _) = connect_async(Url::parse(&url).unwrap())
                .await
                .expect("Failed to connect");

            // Create Session
            let create_msg = ClientMessage::CreateSession {
                cwd: "/".to_string(),
                shell: format!("test-shell-{}", i),
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            };
            socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

            // Wait for session list confirmation
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(10) {
                if let Some(Ok(Message::Text(text))) = socket.next().await {
                    if let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text) {
                        if !sessions.is_empty() {
                            created_count.fetch_add(1, Ordering::SeqCst);

                            // Kill the session we just created
                            let kill_msg = ClientMessage::KillSession {
                                session_id: sessions[0].id.clone(),
                            };
                            socket.send(Message::Text(serde_json::to_string(&kill_msg).unwrap())).await.unwrap();
                            break;
                        }
                    }
                }
            }
        }));
    }

    // Wait for all tasks
    for handle in handles {
        let _ = handle.await;
    }

    let final_count = created.load(Ordering::SeqCst);
    assert!(
        final_count >= session_count * 90 / 100,
        "Only {}/{} sessions were created successfully (expected at least 90%)",
        final_count,
        session_count
    );
}

/// Test streaming large output (simulated via mock PTY)
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_large_output_streaming() {
    let (ws_url, _server) = spawn_stress_server("largeoutput").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Create a session
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    // Get session ID
    let mut session_id = String::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text) {
                if !sessions.is_empty() {
                    session_id = sessions[0].id.clone();
                    break;
                }
            }
        }
    }
    assert!(!session_id.is_empty(), "Failed to get session ID");

    // Attach to session
    let attach_msg = ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    };
    socket.send(Message::Text(serde_json::to_string(&attach_msg).unwrap())).await.unwrap();

    // Send many large inputs to generate output
    let large_input = "X".repeat(10_000); // 10KB input
    let iterations = 100; // 1MB total

    for _ in 0..iterations {
        let input_msg = ClientMessage::Input {
            session_id: session_id.clone(),
            data: large_input.clone(),
        };
        socket.send(Message::Text(serde_json::to_string(&input_msg).unwrap())).await.unwrap();
    }

    // Count received output
    let mut total_received = 0usize;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(10) && total_received < large_input.len() * iterations {
        tokio::select! {
            msg = socket.next() => {
                if let Some(Ok(Message::Text(text))) = msg {
                    if let Ok(ServerMessage::Output { data, .. }) = serde_json::from_str::<ServerMessage>(&text) {
                        total_received += data.len();
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                // Timeout per iteration
            }
        }
    }

    // We should receive at least some output (mock PTY echoes input)
    assert!(
        total_received > 0,
        "Expected to receive output, got {} bytes",
        total_received
    );
}

/// Test 50 concurrent WebSocket clients
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_50_concurrent_clients() {
    let (ws_url, _server) = spawn_stress_server("50clients").await;
    let client_count = 50;
    let connected = Arc::new(AtomicUsize::new(0));
    let mut handles = vec![];

    for i in 0..client_count {
        let url = ws_url.clone();
        let connected_count = connected.clone();

        handles.push(tokio::spawn(async move {
            match connect_async(Url::parse(&url).unwrap()).await {
                Ok((mut socket, _)) => {
                    connected_count.fetch_add(1, Ordering::SeqCst);

                    // Each client creates a session
                    let create_msg = ClientMessage::CreateSession {
                        cwd: "/".to_string(),
                        shell: format!("client-{}", i),
                        env: HashMap::new(),
                        cols: 80,
                        rows: 24,
                    };
                    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

                    // Wait for session list
                    let start = Instant::now();
                    while start.elapsed() < Duration::from_secs(5) {
                        if let Some(Ok(Message::Text(text))) = socket.next().await {
                            if let Ok(ServerMessage::SessionList { .. }) = serde_json::from_str::<ServerMessage>(&text) {
                                break;
                            }
                        }
                    }

                    // Keep connection open briefly
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                Err(e) => {
                    eprintln!("Client {} failed to connect: {}", i, e);
                }
            }
        }));
    }

    // Wait for all clients
    for handle in handles {
        let _ = handle.await;
    }

    let final_count = connected.load(Ordering::SeqCst);
    assert!(
        final_count >= client_count * 95 / 100,
        "Only {}/{} clients connected (expected at least 95%)",
        final_count,
        client_count
    );
}

/// Test rapid input throughput
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_rapid_input_throughput() {
    let (ws_url, _server) = spawn_stress_server("rapidinput").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    // Create a session
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    };
    socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

    // Get session ID
    let mut session_id = String::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if let Some(Ok(Message::Text(text))) = socket.next().await {
            if let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text) {
                if !sessions.is_empty() {
                    session_id = sessions[0].id.clone();
                    break;
                }
            }
        }
    }
    assert!(!session_id.is_empty(), "Failed to get session ID");

    // Attach to session
    let attach_msg = ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    };
    socket.send(Message::Text(serde_json::to_string(&attach_msg).unwrap())).await.unwrap();

    // Small delay for attach to complete
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Send 1000 messages as fast as possible
    let message_count = 1000;
    let start = Instant::now();

    for i in 0..message_count {
        let input_msg = ClientMessage::Input {
            session_id: session_id.clone(),
            data: format!("msg-{}\n", i),
        };
        socket.send(Message::Text(serde_json::to_string(&input_msg).unwrap())).await.unwrap();
    }

    let elapsed = start.elapsed();
    let messages_per_sec = message_count as f64 / elapsed.as_secs_f64();

    println!(
        "Sent {} messages in {:?} ({:.0} msg/sec)",
        message_count, elapsed, messages_per_sec
    );

    // We should be able to send at least 100 messages per second
    assert!(
        messages_per_sec > 100.0,
        "Throughput too low: {:.0} msg/sec (expected > 100)",
        messages_per_sec
    );
}

/// Test rapid session create/delete cycle
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_rapid_session_lifecycle() {
    let (ws_url, _server) = spawn_stress_server("lifecycle").await;

    let (mut socket, _) = connect_async(Url::parse(&ws_url).unwrap())
        .await
        .expect("Failed to connect");

    let cycles = 20;
    let mut successful_cycles = 0;

    for i in 0..cycles {
        // Create session
        let create_msg = ClientMessage::CreateSession {
            cwd: "/".to_string(),
            shell: format!("cycle-{}", i),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
        };
        socket.send(Message::Text(serde_json::to_string(&create_msg).unwrap())).await.unwrap();

        // Wait for session list
        let mut session_id = String::new();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if let Some(Ok(Message::Text(text))) = socket.next().await {
                if let Ok(ServerMessage::SessionList { sessions }) = serde_json::from_str::<ServerMessage>(&text) {
                    // Find our session
                    for s in &sessions {
                        if s.shell == format!("cycle-{}", i) {
                            session_id = s.id.clone();
                            break;
                        }
                    }
                    if !session_id.is_empty() {
                        break;
                    }
                }
            }
        }

        if session_id.is_empty() {
            continue;
        }

        // Kill session
        let kill_msg = ClientMessage::KillSession {
            session_id: session_id.clone(),
        };
        socket.send(Message::Text(serde_json::to_string(&kill_msg).unwrap())).await.unwrap();

        // Wait for session closed confirmation
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if let Some(Ok(Message::Text(text))) = socket.next().await {
                if let Ok(ServerMessage::SessionClosed { session_id: closed_id }) = serde_json::from_str::<ServerMessage>(&text) {
                    if closed_id == session_id {
                        successful_cycles += 1;
                        break;
                    }
                }
            }
        }
    }

    assert!(
        successful_cycles >= cycles * 80 / 100,
        "Only {}/{} cycles completed (expected at least 80%)",
        successful_cycles,
        cycles
    );
}
