use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::time::Duration;
use terminar_server::config::Cli;
use terminar_server::messages::{ClientMessage, ServerMessage};
use terminar_server::run_server;
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

async fn spawn_server() -> (String, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let cli = Cli {
        port,
        socket: Some(format!("/tmp/test-concurrency-{}.sock", port)),
        log_level: "error".to_string(),
        no_auth: true,
        mock_pty: true,
        log_json: false,
        log_file: None,
        audit_level: "off".to_string(),
    };

    let socket_path = cli.socket.clone().unwrap();
    let handle = tokio::spawn(async move {
        run_server(cli, &socket_path).await.unwrap();
    });

    tokio::time::sleep(Duration::from_millis(500)).await;
    (format!("ws://127.0.0.1:{}/ws", port), handle)
}

#[tokio::test]
#[ignore = "Integration test - runs in CI but too slow for local sandbox"]
async fn test_concurrent_clients() {
    let (ws_url, _server) = spawn_server().await;
    let client_count = 10;
    let mut handles = vec![];

    for i in 0..client_count {
        let url = ws_url.clone();
        handles.push(tokio::spawn(async move {
            let (mut socket, _) = connect_async(&url).await.expect("Failed to connect");

            // Create Session
            let create_msg = ClientMessage::CreateSession {
                cwd: "/".to_string(),
                shell: "bash".to_string(),
                env: HashMap::new(),
                cols: 80,
                rows: 24,
            };
            socket
                .send(Message::Text(serde_json::to_string(&create_msg).unwrap()))
                .await
                .unwrap();

            // Get Session ID
            let mut session_id = String::new();
            while let Some(Ok(Message::Text(text))) = socket.next().await {
                if let Ok(ServerMessage::SessionList { sessions }) =
                    serde_json::from_str::<ServerMessage>(&text)
                {
                    if !sessions.is_empty() {
                        session_id = sessions[0].id.clone();
                        break;
                    }
                }
            }
            assert!(!session_id.is_empty());

            // Attach
            let attach_msg = ClientMessage::Attach {
                session_id: session_id.clone(),
                mode: "mirror".to_string(),
            };
            socket
                .send(Message::Text(serde_json::to_string(&attach_msg).unwrap()))
                .await
                .unwrap();

            // Send unique input
            let unique_str = format!("Client-{}", i);
            let input_msg = ClientMessage::Input {
                session_id: session_id.clone(),
                data: unique_str.clone(),
            };
            socket
                .send(Message::Text(serde_json::to_string(&input_msg).unwrap()))
                .await
                .unwrap();

            // Verify echo
            let mut found = false;
            let start = std::time::Instant::now();
            while start.elapsed() < Duration::from_secs(5) {
                if let Some(Ok(Message::Text(text))) = socket.next().await {
                    if let Ok(ServerMessage::Output { data, .. }) =
                        serde_json::from_str::<ServerMessage>(&text)
                    {
                        if data.contains(&unique_str) {
                            found = true;
                            break;
                        }
                    }
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
