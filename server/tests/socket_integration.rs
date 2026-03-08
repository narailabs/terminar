use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

// This test requires the server to be running separately, OR we spawn it here.
// Since spawning complex async servers in test harness is tricky, we'll keep this
// as a manual integration test that can be enabled with a feature flag or run explicitly.
//
// Usage: cargo test --test socket_integration -- --ignored

#[tokio::test]
#[ignore]
async fn test_real_socket_connection() {
    let uid = unsafe { libc::getuid() };
    let socket_path = format!("/tmp/vscode-terminar-{}.sock", uid);

    // 1. Attempt to connect (Server must be running!)
    let mut stream = UnixStream::connect(&socket_path)
        .await
        .expect("Failed to connect to server - is it running?");

    // 2. Send ListSessions
    let req = r#"{"type":"list_sessions"}"#;
    stream.write_all(req.as_bytes()).await.unwrap();
    stream.write_all(b"\n").await.unwrap();

    // 3. Read Response
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).await.unwrap();
    let resp = String::from_utf8_lossy(&buf[0..n]);

    println!("Response: {}", resp);
    assert!(resp.contains("session_list"));
}
