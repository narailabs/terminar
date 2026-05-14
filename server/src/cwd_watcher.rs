//! Per-session OSC sniffer that:
//!   1. Keeps `session.cwd` up to date for remote sessions via OSC 7
//!      (SSH / Docker, where the local polling path in
//!      `poll_foreground_processes` can't see the remote shell).
//!   2. Intercepts OSC 52 (clipboard) and OSC 7777 (`open_url`) sequences
//!      emitted by programs running inside the session and forwards them
//!      as `ServerMessage::ClipboardWrite` / `::OpenUrl` on the server-wide
//!      `tool_action_tx` broadcast channel, so attached clients can execute
//!      them on the user's local system.
//!
//! Design: after an SSH or Docker session is created, the server spawns a
//! tokio task via [`spawn_cwd_watcher`] that subscribes to the session's
//! output broadcast channel and feeds every `SessionEvent::Output` chunk
//! through an [`OscParser`]. For each recognized event:
//! - `OscEvent::Cwd(path)` → locks the session map, updates `session.cwd`,
//!   and broadcasts `SessionEvent::CwdChanged` on the session's output
//!   channel (existing path; `handle_attach` already forwards it).
//! - `OscEvent::ClipboardWrite(bytes)` → sends `ServerMessage::ClipboardWrite`
//!   on the `tool_action_tx` channel.
//! - `OscEvent::OpenUrl(url)` → sends `ServerMessage::OpenUrl` on the
//!   `tool_action_tx` channel.
//!
//! The watcher does NOT strip the OSC bytes from the original stream.
//! Clients forwarding raw output are unaffected — xterm.js ignores unknown
//! OSC sequences and has no handler for OSC 7 / 52 / 7777 by default, so
//! these bytes are invisible in the rendered terminal.

use crate::messages::ServerMessage;
use crate::osc_parser::{OscEvent, OscParser};
use crate::session::{SessionEvent, SessionMap};
use tokio::sync::broadcast::Sender;
use tokio::sync::broadcast::error::RecvError;
use tracing::{debug, trace};

/// Spawn a tokio task that watches a session's output for OSC sequences
/// terminar knows how to act on (OSC 7 cwd, OSC 52 clipboard, OSC 7777
/// open_url).
///
/// Returns immediately after subscribing to the broadcast channel. If the
/// session is not found when the task starts, the task exits silently.
///
/// The task runs until the session's broadcast channel closes (all senders
/// dropped) or a `Closed` / `Exited` event is observed.
///
/// `tool_action_tx` is the server-wide channel used to deliver clipboard
/// and URL-open events to attached clients; see `AppState::tool_action_tx`.
pub fn spawn_cwd_watcher(
    session_id: String,
    sessions: SessionMap,
    tool_action_tx: Sender<(String, ServerMessage)>,
) {
    // Subscribe to the broadcast channel while holding the session map lock.
    let mut rx = {
        let guard = sessions.lock();
        match guard.get(&session_id) {
            Some(session) => session.output_tx.subscribe(),
            None => {
                debug!(
                    session_id = %session_id,
                    "spawn_cwd_watcher: session not found at spawn time"
                );
                return;
            }
        }
    };

    tokio::spawn(async move {
        let mut parser = OscParser::new();
        trace!(session_id = %session_id, "osc watcher: started");

        loop {
            match rx.recv().await {
                Ok(SessionEvent::Output(data)) => {
                    for event in parser.feed(data.as_bytes()) {
                        handle_osc_event(event, &session_id, &sessions, &tool_action_tx);
                    }
                }
                Ok(SessionEvent::Closed) | Ok(SessionEvent::Exited(_)) => {
                    trace!(session_id = %session_id, "osc watcher: session closed/exited");
                    break;
                }
                // Events we don't care about — keep looping.
                Ok(SessionEvent::Bell)
                | Ok(SessionEvent::Activity)
                | Ok(SessionEvent::Silence)
                | Ok(SessionEvent::ForegroundChanged(_))
                | Ok(SessionEvent::CwdChanged(_)) => {}
                Err(RecvError::Lagged(n)) => {
                    debug!(
                        session_id = %session_id,
                        skipped = n,
                        "osc watcher: broadcast lagged, some output missed"
                    );
                    // Parser may be mid-sequence; reset to a clean state so a
                    // skipped ST terminator doesn't leave us stuck.
                    parser = OscParser::new();
                }
                Err(RecvError::Closed) => {
                    trace!(session_id = %session_id, "osc watcher: broadcast closed");
                    break;
                }
            }
        }
    });
}

/// Dispatch a parsed `OscEvent` to the right destination.
fn handle_osc_event(
    event: OscEvent,
    session_id: &str,
    sessions: &SessionMap,
    tool_action_tx: &Sender<(String, ServerMessage)>,
) {
    match event {
        OscEvent::Cwd(new_cwd) => update_cwd(sessions, session_id, new_cwd),
        OscEvent::ClipboardWrite(bytes) => {
            // OSC 52 payloads should be UTF-8 text in practice; lossy decode
            // because we'd rather deliver a degraded string than drop the
            // whole copy action when the remote sent non-UTF-8.
            let text = String::from_utf8_lossy(&bytes).into_owned();
            debug!(
                session_id = %session_id,
                bytes = bytes.len(),
                "osc watcher: OSC 52 clipboard write → forwarding to clients"
            );
            let _ = tool_action_tx.send((
                session_id.to_string(),
                ServerMessage::ClipboardWrite {
                    session_id: session_id.to_string(),
                    data: text,
                },
            ));
        }
        OscEvent::OpenUrl(url) => {
            debug!(
                session_id = %session_id,
                url = %url,
                "osc watcher: OSC 7777 open_url → forwarding to clients"
            );
            let _ = tool_action_tx.send((
                session_id.to_string(),
                ServerMessage::OpenUrl {
                    session_id: session_id.to_string(),
                    url,
                },
            ));
        }
        OscEvent::EditRequest {
            id,
            filename,
            contents,
        } => {
            // File contents may contain secrets (users editing .env, key files,
            // etc.), so we decode with `from_utf8_lossy` but NEVER log the
            // bytes themselves — only the byte count and a lossy flag.
            let byte_count = contents.len();
            let text = String::from_utf8_lossy(&contents);
            let lossy = matches!(text, std::borrow::Cow::Owned(_));
            let text = text.into_owned();
            if lossy {
                debug!(
                    session_id = %session_id,
                    bytes = byte_count,
                    lossy = true,
                    "osc watcher: OSC 7777 edit_request contents were not valid UTF-8"
                );
            }
            debug!(
                session_id = %session_id,
                bytes = byte_count,
                lossy,
                "osc watcher: OSC 7777 edit_request → forwarding to clients"
            );
            let _ = tool_action_tx.send((
                session_id.to_string(),
                ServerMessage::EditRequest {
                    session_id: session_id.to_string(),
                    id,
                    filename,
                    contents: text,
                },
            ));
        }
    }
}

/// Update a session's cwd in the map and broadcast a CwdChanged event if the
/// value actually changed. The broadcast is sent while the lock is held,
/// which is fine because `broadcast::Sender::send` is non-blocking (it drops
/// messages if all receivers are lagged).
fn update_cwd(sessions: &SessionMap, session_id: &str, new_cwd: String) {
    let mut guard = sessions.lock();
    let Some(session) = guard.get_mut(session_id) else {
        return;
    };
    if session.cwd == new_cwd {
        return;
    }
    let old_cwd = std::mem::replace(&mut session.cwd, new_cwd.clone());
    debug!(
        session_id = %session_id,
        old_cwd = %old_cwd,
        new_cwd = %new_cwd,
        "osc watcher: cwd changed via OSC 7"
    );
    let _ = session.output_tx.send(SessionEvent::CwdChanged(new_cwd));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::{MockPtyProvider, PtyProvider};
    use crate::session::Session;
    use base64::Engine;
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::broadcast;

    // Smoke tests for the watcher hooked to a mock PTY. Exhaustive OSC parsing
    // is covered in `osc_parser::tests`.

    fn make_session_map() -> SessionMap {
        Arc::new(parking_lot::Mutex::new(HashMap::new()))
    }

    fn insert_test_session(
        sessions: &SessionMap,
        id: &str,
    ) -> tokio::sync::broadcast::Sender<SessionEvent> {
        let provider = MockPtyProvider;
        let master = provider.create_pty(80, 24).unwrap();
        let (tx, _rx) = tokio::sync::broadcast::channel(256);
        let history = Arc::new(parking_lot::Mutex::new(
            terminar_core::history::CircularBuffer::with_default_capacity(),
        ));
        let session = Session::new(
            id.to_string(),
            "test".to_string(),
            "/bin/sh".to_string(),
            "/".to_string(),
            master,
            tx.clone(),
            history,
            None,
            Some("conn-1".to_string()),
        )
        .unwrap();
        sessions.lock().insert(id.to_string(), session);
        tx
    }

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s.as_bytes())
    }

    #[tokio::test]
    async fn watcher_updates_cwd_on_osc7() {
        let sessions = make_session_map();
        let tx = insert_test_session(&sessions, "s1");
        let (tool_tx, _tool_rx) = broadcast::channel(16);
        // Subscribe BEFORE the watcher so we see the CwdChanged broadcast.
        let mut observer = tx.subscribe();

        spawn_cwd_watcher("s1".to_string(), sessions.clone(), tool_tx);
        tokio::task::yield_now().await;

        tx.send(SessionEvent::Output(
            "\x1b]7;file://host/Users/me/work\x07".to_string(),
        ))
        .unwrap();

        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        let mut seen = None;
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_millis(100), observer.recv()).await {
                Ok(Ok(SessionEvent::CwdChanged(path))) => {
                    seen = Some(path);
                    break;
                }
                Ok(Ok(_)) => continue,
                Ok(Err(_)) | Err(_) => continue,
            }
        }
        assert_eq!(seen.as_deref(), Some("/Users/me/work"));

        let guard = sessions.lock();
        assert_eq!(guard.get("s1").unwrap().cwd, "/Users/me/work");
    }

    #[tokio::test]
    async fn watcher_does_not_emit_when_cwd_unchanged() {
        let sessions = make_session_map();
        let tx = insert_test_session(&sessions, "s2");
        let (tool_tx, _tool_rx) = broadcast::channel(16);
        // Pre-set the cwd to the value the OSC 7 will report.
        sessions.lock().get_mut("s2").unwrap().cwd = "/stable".to_string();

        let mut observer = tx.subscribe();
        spawn_cwd_watcher("s2".to_string(), sessions.clone(), tool_tx);
        tokio::task::yield_now().await;

        tx.send(SessionEvent::Output(
            "\x1b]7;file://host/stable\x07".to_string(),
        ))
        .unwrap();

        // No CwdChanged should arrive within a short window.
        let result = tokio::time::timeout(Duration::from_millis(150), async {
            loop {
                match observer.recv().await {
                    Ok(SessionEvent::CwdChanged(_)) => return true,
                    Ok(_) => continue,
                    Err(_) => return false,
                }
            }
        })
        .await;
        assert!(result.is_err(), "expected no CwdChanged broadcast");
    }

    #[tokio::test]
    async fn watcher_forwards_osc52_as_clipboard_write() {
        let sessions = make_session_map();
        let tx = insert_test_session(&sessions, "s3");
        let (tool_tx, mut tool_rx) = broadcast::channel(16);

        spawn_cwd_watcher("s3".to_string(), sessions.clone(), tool_tx);
        tokio::task::yield_now().await;

        let osc52 = format!("\x1b]52;c;{}\x07", b64("clipboard contents"));
        tx.send(SessionEvent::Output(osc52)).unwrap();

        let (sid, msg) = tokio::time::timeout(Duration::from_secs(2), tool_rx.recv())
            .await
            .expect("timeout waiting for clipboard event")
            .expect("broadcast recv error");
        assert_eq!(sid, "s3");
        match msg {
            ServerMessage::ClipboardWrite { session_id, data } => {
                assert_eq!(session_id, "s3");
                assert_eq!(data, "clipboard contents");
            }
            other => panic!("expected ClipboardWrite, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn watcher_forwards_osc7777_as_open_url() {
        let sessions = make_session_map();
        let tx = insert_test_session(&sessions, "s4");
        let (tool_tx, mut tool_rx) = broadcast::channel(16);

        spawn_cwd_watcher("s4".to_string(), sessions.clone(), tool_tx);
        tokio::task::yield_now().await;

        let osc = format!(
            "\x1b]7777;open_url;{}\x07",
            b64("https://example.com/auth?code=xyz")
        );
        tx.send(SessionEvent::Output(osc)).unwrap();

        let (sid, msg) = tokio::time::timeout(Duration::from_secs(2), tool_rx.recv())
            .await
            .expect("timeout waiting for open_url event")
            .expect("broadcast recv error");
        assert_eq!(sid, "s4");
        match msg {
            ServerMessage::OpenUrl { session_id, url } => {
                assert_eq!(session_id, "s4");
                assert_eq!(url, "https://example.com/auth?code=xyz");
            }
            other => panic!("expected OpenUrl, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn watcher_forwards_edit_request() {
        let sessions = make_session_map();
        let tx = insert_test_session(&sessions, "s5");
        let (tool_tx, mut tool_rx) = broadcast::channel(16);

        spawn_cwd_watcher("s5".to_string(), sessions.clone(), tool_tx);
        tokio::task::yield_now().await;

        let osc = format!(
            "\x1b]7777;edit_request;{};{};{}\x07",
            b64("req-42"),
            b64("/tmp/notes.txt"),
            b64("hello from remote")
        );
        tx.send(SessionEvent::Output(osc)).unwrap();

        let (sid, msg) = tokio::time::timeout(Duration::from_secs(2), tool_rx.recv())
            .await
            .expect("timeout waiting for edit_request event")
            .expect("broadcast recv error");
        assert_eq!(sid, "s5");
        match msg {
            ServerMessage::EditRequest {
                session_id,
                id,
                filename,
                contents,
            } => {
                assert_eq!(session_id, "s5");
                assert_eq!(id, "req-42");
                assert_eq!(filename, "/tmp/notes.txt");
                assert_eq!(contents, "hello from remote");
            }
            other => panic!("expected EditRequest, got {:?}", other),
        }
    }
}
