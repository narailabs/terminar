//! Shared helpers for Unix-socket integration tests.
//!
//! The server is Unix-socket-only (no network), so these tests connect over a
//! `UnixStream` using the same 4-byte big-endian length-prefixed JSON framing
//! the server's `handle_connection` speaks.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use terminar_server::config::Cli;
use terminar_server::messages::{ClientMessage, ServerMessage};
use terminar_server::run_server;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Spawn a mock-PTY server on a unique Unix socket path. Returns the socket
/// path and the server task handle. Uniqueness is per-process (pid) plus a
/// monotonic counter, so parallel test binaries and cases don't collide.
pub async fn spawn_server(name: &str) -> (String, tokio::task::JoinHandle<()>) {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let socket_path = format!("/tmp/test-{}-{}-{}.sock", name, std::process::id(), n);
    let _ = std::fs::remove_file(&socket_path);

    let cli = Cli {
        socket: Some(socket_path.clone()),
        log_level: "error".to_string(),
        mock_pty: true,
        log_json: false,
        log_file: None,
        audit_level: "off".to_string(),
    };

    let sp = socket_path.clone();
    let handle = tokio::spawn(async move {
        let _ = run_server(cli, &sp).await;
    });

    // Give the server a moment to bind the socket.
    tokio::time::sleep(Duration::from_millis(500)).await;
    (socket_path, handle)
}

/// Connect to a server's Unix socket.
pub async fn connect(socket_path: &str) -> UnixStream {
    UnixStream::connect(socket_path)
        .await
        .expect("failed to connect to unix socket")
}

/// Send a length-prefixed `ClientMessage`.
pub async fn send_message(stream: &mut UnixStream, msg: &ClientMessage) {
    let json = serde_json::to_string(msg).unwrap();
    let bytes = json.as_bytes();
    stream
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .await
        .unwrap();
    stream.write_all(bytes).await.unwrap();
}

/// Send a raw length-prefixed frame (for malformed/non-UTF8 payload tests).
pub async fn send_raw_frame(stream: &mut UnixStream, payload: &[u8]) {
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await
        .unwrap();
    stream.write_all(payload).await.unwrap();
}

/// Receive one length-prefixed `ServerMessage` (5s timeout). Returns `None` on
/// timeout, EOF, or a payload that doesn't parse as a `ServerMessage`.
pub async fn recv_message(stream: &mut UnixStream) -> Option<ServerMessage> {
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
    serde_json::from_slice(&payload).ok()
}

/// A `CreateSession` message with sensible defaults for tests.
pub fn create_session_msg() -> ClientMessage {
    ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "/bin/bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    }
}

/// Create a session and return the first session id from the resulting
/// `SessionList` (drains any interleaved messages until one arrives).
pub async fn create_session(stream: &mut UnixStream) -> String {
    send_message(stream, &create_session_msg()).await;
    loop {
        match recv_message(stream).await {
            Some(ServerMessage::SessionList { sessions }) if !sessions.is_empty() => {
                return sessions[0].id.clone();
            }
            Some(_) => continue,
            None => panic!("no SessionList received after CreateSession"),
        }
    }
}
