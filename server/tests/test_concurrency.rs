use std::time::Duration;
use terminar_server::messages::{ClientMessage, ServerMessage};

mod common;
use common::{connect, recv_message, send_message, spawn_server};

#[tokio::test]
#[ignore = "Integration test - runs in CI but too slow for local sandbox"]
async fn test_concurrent_clients() {
    let (socket_path, _server) = spawn_server("concurrency").await;
    let client_count = 10;
    let mut handles = vec![];

    for i in 0..client_count {
        let path = socket_path.clone();
        handles.push(tokio::spawn(async move {
            let mut stream = connect(&path).await;

            // Create Session
            send_message(&mut stream, &common::create_session_msg()).await;

            // Get Session ID
            let mut session_id = String::new();
            while let Some(msg) = recv_message(&mut stream).await {
                if let ServerMessage::SessionList { sessions } = msg
                    && !sessions.is_empty()
                {
                    session_id = sessions[0].id.clone();
                    break;
                }
            }
            assert!(!session_id.is_empty());

            // Attach
            let attach_msg = ClientMessage::Attach {
                session_id: session_id.clone(),
                mode: "mirror".to_string(),
            };
            send_message(&mut stream, &attach_msg).await;

            // Send unique input
            let unique_str = format!("Client-{}", i);
            let input_msg = ClientMessage::Input {
                session_id: session_id.clone(),
                data: unique_str.clone(),
            };
            send_message(&mut stream, &input_msg).await;

            // Verify echo
            let mut found = false;
            let start = std::time::Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                if let Some(ServerMessage::Output { data, .. }) = recv_message(&mut stream).await
                    && data.contains(&unique_str)
                {
                    found = true;
                    break;
                }
            }
            assert!(found, "Client {} did not receive echo '{}'", i, unique_str);
        }));
    }

    // Wait for all clients
    for handle in handles {
        handle.await.unwrap();
    }
}
