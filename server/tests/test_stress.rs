//! Stress tests for the terminar server
//!
//! These tests verify the server's behavior under high load conditions.
//! Run with: cargo test --test test_stress -- --ignored

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use terminar_server::messages::{ClientMessage, ServerMessage};

mod common;
use common::{connect, recv_message, send_message, spawn_server};

/// Test creating and deleting 100 sessions rapidly
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_100_concurrent_sessions() {
    let (socket_path, _server) = spawn_server("stress-100sessions").await;
    let session_count = 100;
    let created = Arc::new(AtomicUsize::new(0));
    let mut handles = vec![];

    // Create sessions concurrently
    for i in 0..session_count {
        let path = socket_path.clone();
        let created_count = created.clone();

        handles.push(tokio::spawn(async move {
            let mut stream = connect(&path).await;

            // Create Session
            let create_msg = ClientMessage::CreateSession {
                cwd: "/".to_string(),
                shell: format!("test-shell-{}", i),
                env: HashMap::new(),
                cols: 80,
                rows: 24,
                container_id: None,
                ssh_connection_id: None,
            };
            send_message(&mut stream, &create_msg).await;

            // Wait for session list confirmation
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(10) {
                match recv_message(&mut stream).await {
                    Some(ServerMessage::SessionList { sessions }) if !sessions.is_empty() => {
                        created_count.fetch_add(1, Ordering::SeqCst);

                        // Kill the session we just created
                        let kill_msg = ClientMessage::KillSession {
                            session_id: sessions[0].id.clone(),
                        };
                        send_message(&mut stream, &kill_msg).await;
                        break;
                    }
                    Some(_) => continue,
                    None => break,
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
    let (socket_path, _server) = spawn_server("stress-largeoutput").await;

    let mut stream = connect(&socket_path).await;

    // Create a session
    send_message(&mut stream, &common::create_session_msg()).await;

    // Get session ID
    let mut session_id = String::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if let Some(ServerMessage::SessionList { sessions }) = recv_message(&mut stream).await
            && !sessions.is_empty()
        {
            session_id = sessions[0].id.clone();
            break;
        }
    }
    assert!(!session_id.is_empty(), "Failed to get session ID");

    // Attach to session
    let attach_msg = ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    };
    send_message(&mut stream, &attach_msg).await;

    // Send many large inputs to generate output
    let large_input = "X".repeat(10_000); // 10KB input
    let iterations = 100; // 1MB total

    for _ in 0..iterations {
        let input_msg = ClientMessage::Input {
            session_id: session_id.clone(),
            data: large_input.clone(),
        };
        send_message(&mut stream, &input_msg).await;
    }

    // Count received output
    let mut total_received = 0usize;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(10)
        && total_received < large_input.len() * iterations
    {
        match recv_message(&mut stream).await {
            Some(ServerMessage::Output { data, .. }) => total_received += data.len(),
            Some(_) => continue,
            None => break,
        }
    }

    // We should receive at least some output (mock PTY echoes input)
    assert!(
        total_received > 0,
        "Expected to receive output, got {} bytes",
        total_received
    );
}

/// Test 50 concurrent clients
#[tokio::test]
#[ignore = "Stress test - run explicitly with --ignored"]
async fn test_50_concurrent_clients() {
    let (socket_path, _server) = spawn_server("stress-50clients").await;
    let client_count = 50;
    let connected = Arc::new(AtomicUsize::new(0));
    let mut handles = vec![];

    for i in 0..client_count {
        let path = socket_path.clone();
        let connected_count = connected.clone();

        handles.push(tokio::spawn(async move {
            let mut stream = connect(&path).await;
            connected_count.fetch_add(1, Ordering::SeqCst);

            // Each client creates a session
            let create_msg = ClientMessage::CreateSession {
                cwd: "/".to_string(),
                shell: format!("client-{}", i),
                env: HashMap::new(),
                cols: 80,
                rows: 24,
                container_id: None,
                ssh_connection_id: None,
            };
            send_message(&mut stream, &create_msg).await;

            // Wait for session list
            let start = Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                match recv_message(&mut stream).await {
                    Some(ServerMessage::SessionList { .. }) => break,
                    Some(_) => continue,
                    None => break,
                }
            }

            // Keep connection open briefly
            tokio::time::sleep(Duration::from_millis(500)).await;
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
    let (socket_path, _server) = spawn_server("stress-rapidinput").await;

    let mut stream = connect(&socket_path).await;

    // Create a session
    send_message(&mut stream, &common::create_session_msg()).await;

    // Get session ID
    let mut session_id = String::new();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if let Some(ServerMessage::SessionList { sessions }) = recv_message(&mut stream).await
            && !sessions.is_empty()
        {
            session_id = sessions[0].id.clone();
            break;
        }
    }
    assert!(!session_id.is_empty(), "Failed to get session ID");

    // Attach to session
    let attach_msg = ClientMessage::Attach {
        session_id: session_id.clone(),
        mode: "mirror".to_string(),
    };
    send_message(&mut stream, &attach_msg).await;

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
        send_message(&mut stream, &input_msg).await;
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
    let (socket_path, _server) = spawn_server("stress-lifecycle").await;

    let mut stream = connect(&socket_path).await;

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
            container_id: None,
            ssh_connection_id: None,
        };
        send_message(&mut stream, &create_msg).await;

        // Wait for session list
        let mut session_id = String::new();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if let Some(ServerMessage::SessionList { sessions }) = recv_message(&mut stream).await {
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

        if session_id.is_empty() {
            continue;
        }

        // Kill session
        let kill_msg = ClientMessage::KillSession {
            session_id: session_id.clone(),
        };
        send_message(&mut stream, &kill_msg).await;

        // Wait for session closed confirmation
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if let Some(ServerMessage::SessionClosed {
                session_id: closed_id,
            }) = recv_message(&mut stream).await
                && closed_id == session_id
            {
                successful_cycles += 1;
                break;
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
