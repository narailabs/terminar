//! I/O message handlers: Input, Resize, Attach, EditReply.

use crate::handlers::session::clamp_dimension;
use crate::messages::ServerMessage;
use crate::session::{SessionEvent, SessionMap};

use base64::Engine;
use portable_pty::PtySize;
use tokio::sync::broadcast;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc;
use tracing::{error, info, instrument};

/// Handle Input message.
#[instrument(skip(data, tx_out, sessions), fields(session_id = %session_id))]
pub(crate) async fn handle_input(
    session_id: &str,
    data: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    // Scope the lock so the MutexGuard is dropped before any .await
    let result = {
        let guard = sessions.lock();
        if let Some(session) = guard.get(session_id) {
            if !session.allows_input() {
                Err(format!(
                    "Session '{}' is not accepting input (state: {:?})",
                    session_id, session.state
                ))
            } else {
                // Use the cached writer instead of calling take_writer() each time.
                let mut writer_guard = session.writer.lock();
                use std::io::Write;
                if let Err(e) = writer_guard.write_all(data.as_bytes()) {
                    error!("Failed to write to PTY: {}", e);
                } else {
                    let _ = writer_guard.flush();
                }
                Ok(())
            }
        } else {
            Err(format!("Session '{}' not found", session_id))
        }
    };
    // Now the guard is dropped, safe to .await
    if let Err(ref message) = result {
        info!(session_id = %session_id, event = "session_error", error = %message, "Session lifecycle: error");
        tx_out
            .send(ServerMessage::Error {
                message: message.clone(),
                error_code: Some("SESSION_NOT_FOUND".to_string()),
            })
            .await?;
    }
    Ok(())
}

/// Handle Resize message.
#[instrument(skip(tx_out, sessions), fields(session_id = %session_id, cols = cols, rows = rows))]
pub(crate) async fn handle_resize(
    session_id: &str,
    cols: u16,
    rows: u16,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    // Clamp dimensions to valid range (1-500)
    let cols = clamp_dimension(cols, "cols");
    let rows = clamp_dimension(rows, "rows");

    let found = {
        let guard = sessions.lock();
        if let Some(session) = guard.get(session_id) {
            // Lock the master mutex for exclusive access
            let master_guard = session.master.lock();
            let _ = master_guard.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
            true
        } else {
            false
        }
    };
    if !found {
        tx_out
            .send(ServerMessage::Error {
                message: format!("Session '{}' not found", session_id),
                error_code: Some("SESSION_NOT_FOUND".to_string()),
            })
            .await?;
    }
    Ok(())
}

/// Validate that an `EditReply` id is safe to interpolate into the framing
/// markers. The id is embedded between `__TERMINAR_EDIT_` and `_BEGIN__` /
/// `_END__` / `_CANCEL__`, so we restrict it to characters that cannot break
/// out of the marker or inject shell metacharacters on the remote side.
///
/// Allowed: ASCII letters, digits, `_`, and `-`. Empty ids are rejected.
fn is_valid_edit_reply_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Wrap a base64 string at 76 characters per line (standard MIME wrap). The
/// result is joined with `\n` and does NOT include a trailing newline — callers
/// add their own framing newlines.
fn wrap_base64(encoded: &str) -> String {
    if encoded.is_empty() {
        return String::new();
    }
    let bytes = encoded.as_bytes();
    let mut out = String::with_capacity(encoded.len() + encoded.len() / 76);
    let mut i = 0;
    while i < bytes.len() {
        let end = (i + 76).min(bytes.len());
        // Safe: base64 output is ASCII, so byte boundaries == char boundaries.
        out.push_str(&encoded[i..end]);
        if end < bytes.len() {
            out.push('\n');
        }
        i = end;
    }
    out
}

/// Build the framed response body that the remote `terminar-edit` wrapper
/// script reads from its stdin. See `handle_edit_reply` for the framing
/// contract.
fn build_edit_reply_frame(id: &str, contents: &str, cancelled: bool) -> Vec<u8> {
    if cancelled {
        return format!("\n__TERMINAR_EDIT_{}_CANCEL__\n", id).into_bytes();
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(contents.as_bytes());
    let wrapped = wrap_base64(&encoded);
    format!(
        "\n__TERMINAR_EDIT_{id}_BEGIN__\n{wrapped}\n__TERMINAR_EDIT_{id}_END__\n",
        id = id,
        wrapped = wrapped,
    )
    .into_bytes()
}

/// Handle an `EditReply` from the client: write a framed response to the
/// session's PTY stdin that the remote `terminar-edit` wrapper script will
/// decode.
///
/// Framing contract (read by the remote POSIX `sh` wrapper):
///
/// - Normal (save) case:
///   ```text
///   \n__TERMINAR_EDIT_<id>_BEGIN__\n
///   <base64-of-contents-wrapped-at-76-chars>\n
///   __TERMINAR_EDIT_<id>_END__\n
///   ```
/// - Cancellation case:
///   ```text
///   \n__TERMINAR_EDIT_<id>_CANCEL__\n
///   ```
///
/// The leading `\n` flushes any partial line the user may have typed in the
/// terminal buffer so the wrapper's line-oriented `read` loop sees a fresh
/// line.
///
/// # Security
///
/// The `id` is interpolated into the markers, so it is validated against
/// `[A-Za-z0-9_-]+` to prevent the wrapper from being tricked into a bogus
/// marker or from shell-metacharacter injection if the id ever ends up in a
/// subshell.
///
/// The `contents` may contain user secrets (the text being edited) and is
/// NEVER logged. Only the id, byte count, and cancelled flag are logged.
#[instrument(skip(contents, tx_out, sessions), fields(session_id = %session_id, id = %id, cancelled = cancelled, bytes = contents.len()))]
pub(crate) async fn handle_edit_reply(
    session_id: &str,
    id: &str,
    contents: &str,
    cancelled: bool,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Validate id before touching any state.
    if !is_valid_edit_reply_id(id) {
        info!(
            session_id = %session_id,
            id = %id,
            event = "edit_reply_invalid_id",
            "EditReply rejected: id failed validation"
        );
        tx_out
            .send(ServerMessage::Error {
                message: format!(
                    "Invalid edit_reply id '{}': must be non-empty and match [A-Za-z0-9_-]+",
                    id
                ),
                error_code: Some("EDIT_REPLY_INVALID_ID".to_string()),
            })
            .await?;
        return Ok(());
    }

    // 2. Build the framed response (no session state needed for this step;
    //    cheap enough to do before taking the lock so the lock scope stays
    //    tight).
    let frame = build_edit_reply_frame(id, contents, cancelled);

    // 3. Lock the session map, look up the session, write to the cached
    //    writer, and drop both locks before any .await — same pattern as
    //    `handle_input`.
    let result: Result<(), String> = {
        let guard = sessions.lock();
        if let Some(session) = guard.get(session_id) {
            let mut writer_guard = session.writer.lock();
            use std::io::Write;
            if let Err(e) = writer_guard.write_all(&frame) {
                error!("Failed to write edit_reply frame to PTY: {}", e);
                Err(format!("Failed to write edit_reply to PTY: {}", e))
            } else {
                let _ = writer_guard.flush();
                Ok(())
            }
        } else {
            Err(format!("Session '{}' not found", session_id))
        }
    };

    if let Err(message) = result {
        let error_code = if message.starts_with("Session '") {
            "SESSION_NOT_FOUND"
        } else {
            "EDIT_REPLY_WRITE_FAILED"
        };
        info!(
            session_id = %session_id,
            id = %id,
            event = "edit_reply_error",
            error_code = %error_code,
            error = %message,
            "EditReply failed"
        );
        tx_out
            .send(ServerMessage::Error {
                message,
                error_code: Some(error_code.to_string()),
            })
            .await?;
    } else {
        info!(
            session_id = %session_id,
            id = %id,
            cancelled = cancelled,
            event = "edit_reply_sent",
            "EditReply written to PTY"
        );
    }
    Ok(())
}

/// Map of session_id → forwarding task handle, used to cancel old forwarders on re-attach.
pub type AttachTasks = std::collections::HashMap<String, tokio::task::JoinHandle<()>>;

/// Handle Attach message.
#[instrument(skip(tx_out, sessions, tool_action_tx, attach_tasks), fields(session_id = %session_id))]
pub(crate) async fn handle_attach(
    session_id: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
    tool_action_tx: &broadcast::Sender<(String, ServerMessage)>,
    attach_tasks: &mut AttachTasks,
) -> Result<(), Box<dyn std::error::Error>> {
    // Cancel any existing forwarder for this session on this connection
    if let Some(old_task) = attach_tasks.remove(session_id) {
        old_task.abort();
    }

    let history_data_opt = {
        let guard = sessions.lock();
        if let Some(session) = guard.get(session_id) {
            let h = session.history.lock();
            let raw = h.to_vec();
            // Use from_utf8_lossy here because the circular buffer may start
            // mid-character if a character was split at the ring boundary.
            Some((
                String::from_utf8_lossy(&raw).to_string(),
                session.output_tx.subscribe(),
            ))
        } else {
            None
        }
    };

    if let Some((history_data, mut rx)) = history_data_opt {
        info!(session_id = %session_id, event = "session_attached", "Session lifecycle: attached");
        tx_out
            .send(ServerMessage::Output {
                session_id: session_id.to_string(),
                data: history_data,
            })
            .await?;

        let tx_out_clone = tx_out.clone();
        let session_id_clone = session_id.to_string();
        let mut tool_rx = tool_action_tx.subscribe();

        let handle = tokio::spawn(async move {
            // Track whether the tool-action channel is still alive. If it
            // closes (server shutdown), disable that select branch rather
            // than tearing down the attach — the session may still be live.
            let mut tool_closed = false;

            loop {
                tokio::select! {
                    // Session output is the critical stream; prefer it.
                    biased;

                    event = rx.recv() => {
                        let Ok(event) = event else { break; };
                        match event {
                            SessionEvent::Output(data) => {
                                if tx_out_clone
                                    .send(ServerMessage::Output {
                                        session_id: session_id_clone.clone(),
                                        data,
                                    })
                                    .await
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            SessionEvent::Closed => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::SessionClosed {
                                        session_id: session_id_clone.clone(),
                                    })
                                    .await;
                                break;
                            }
                            SessionEvent::Exited(exit_code) => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::SessionExited {
                                        session_id: session_id_clone.clone(),
                                        exit_code,
                                    })
                                    .await;
                                break;
                            }
                            SessionEvent::Bell => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::SessionActivity {
                                        session_id: session_id_clone.clone(),
                                        activity_type: "bell".to_string(),
                                    })
                                    .await;
                            }
                            SessionEvent::Activity => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::SessionActivity {
                                        session_id: session_id_clone.clone(),
                                        activity_type: "activity".to_string(),
                                    })
                                    .await;
                            }
                            SessionEvent::Silence => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::SessionActivity {
                                        session_id: session_id_clone.clone(),
                                        activity_type: "silence".to_string(),
                                    })
                                    .await;
                            }
                            SessionEvent::ForegroundChanged(process_name) => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::ForegroundChanged {
                                        session_id: session_id_clone.clone(),
                                        process_name,
                                    })
                                    .await;
                            }
                            SessionEvent::CwdChanged(cwd) => {
                                let _ = tx_out_clone
                                    .send(ServerMessage::CwdChanged {
                                        session_id: session_id_clone.clone(),
                                        cwd,
                                    })
                                    .await;
                            }
                        }
                    }

                    // Server-local tool actions (OSC 52 clipboard, OSC 7777
                    // open_url). The channel is server-wide, so filter by
                    // session_id. Messages are already fully-formed
                    // `ServerMessage`s — forward verbatim.
                    tool = tool_rx.recv(), if !tool_closed => {
                        match tool {
                            Ok((sid, msg)) if sid == session_id_clone => {
                                if tx_out_clone.send(msg).await.is_err() {
                                    break;
                                }
                            }
                            Ok(_) => {} // event for a different session — ignore
                            Err(RecvError::Lagged(_)) => {} // fell behind, drop
                            Err(RecvError::Closed) => {
                                tool_closed = true;
                            }
                        }
                    }
                }
            }
        });
        attach_tasks.insert(session_id.to_string(), handle);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::{MockPtyProvider, PtyProvider};
    use crate::session::Session;
    use base64::Engine;
    use std::collections::HashMap;
    use std::io::Read;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{broadcast, mpsc};

    /// Construct an empty session map.
    fn make_session_map() -> SessionMap {
        Arc::new(parking_lot::Mutex::new(HashMap::new()))
    }

    /// Insert a mock-PTY-backed session and return a reader cloned from the
    /// mock master BEFORE the master was moved into the session. Any bytes
    /// written via the session's cached writer will appear on this reader.
    fn insert_mock_session(sessions: &SessionMap, id: &str) -> Box<dyn Read + Send + 'static> {
        let provider = MockPtyProvider;
        let master = provider.create_pty(80, 24).unwrap();
        // Clone the reader BEFORE moving master into Session::new.
        let reader = master.try_clone_reader().unwrap();
        let (tx, _rx) = broadcast::channel(256);
        let history = Arc::new(parking_lot::Mutex::new(
            terminar_core::history::CircularBuffer::with_default_capacity(),
        ));
        let session = Session::new(
            id.to_string(),
            "test".to_string(),
            "/bin/sh".to_string(),
            "/".to_string(),
            master,
            tx,
            history,
            None,
            None,
        )
        .unwrap();
        sessions.lock().insert(id.to_string(), session);
        reader
    }

    /// Read exactly `n` bytes from a mock PTY reader with a timeout.
    /// Uses `spawn_blocking` because `MockReader::read` is a blocking loop.
    async fn read_exact_with_timeout(
        mut reader: Box<dyn Read + Send + 'static>,
        n: usize,
    ) -> Vec<u8> {
        let fut = tokio::task::spawn_blocking(move || {
            let mut buf = vec![0u8; n];
            reader.read_exact(&mut buf).unwrap();
            buf
        });
        tokio::time::timeout(Duration::from_secs(5), fut)
            .await
            .expect("timed out waiting for bytes on mock PTY")
            .expect("blocking task panicked")
    }

    /// Assert that no bytes have been written to the mock PTY reader within
    /// a short window (used for negative-path tests).
    async fn assert_reader_empty(mut reader: Box<dyn Read + Send + 'static>) {
        let fut = tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 1];
            // MockReader blocks until at least one byte is available, so this
            // will only return if someone wrote. If we time out, nothing was
            // written — that's the pass condition.
            let _ = reader.read(&mut buf);
            buf
        });
        let result = tokio::time::timeout(Duration::from_millis(150), fut).await;
        assert!(
            result.is_err(),
            "expected mock PTY writer to be empty, but got data"
        );
    }

    #[test]
    fn is_valid_edit_reply_id_accepts_safe_chars() {
        assert!(is_valid_edit_reply_id("abc123"));
        assert!(is_valid_edit_reply_id("req-42"));
        assert!(is_valid_edit_reply_id("snake_case"));
        assert!(is_valid_edit_reply_id("UPPER"));
        assert!(is_valid_edit_reply_id("a"));
    }

    #[test]
    fn is_valid_edit_reply_id_rejects_unsafe() {
        assert!(!is_valid_edit_reply_id(""));
        assert!(!is_valid_edit_reply_id("abc;rm -rf /"));
        assert!(!is_valid_edit_reply_id("../etc"));
        assert!(!is_valid_edit_reply_id("abc def"));
        assert!(!is_valid_edit_reply_id("abc\n"));
        assert!(!is_valid_edit_reply_id("abc$(whoami)"));
        assert!(!is_valid_edit_reply_id("abc/def"));
        assert!(!is_valid_edit_reply_id("abc.def"));
    }

    #[test]
    fn wrap_base64_handles_short_input() {
        assert_eq!(wrap_base64(""), "");
        assert_eq!(wrap_base64("abcd"), "abcd");
        let exactly_76 = "a".repeat(76);
        assert_eq!(wrap_base64(&exactly_76), exactly_76);
    }

    #[test]
    fn wrap_base64_wraps_long_input_at_76() {
        let input = "a".repeat(200);
        let wrapped = wrap_base64(&input);
        // Every line must be at most 76 chars, and joining lines must
        // recover the original.
        for line in wrapped.split('\n') {
            assert!(line.len() <= 76, "line too long: {}", line.len());
        }
        assert_eq!(wrapped.replace('\n', ""), input);
    }

    #[tokio::test]
    async fn handle_edit_reply_writes_framed_begin_end() {
        let sessions = make_session_map();
        let reader = insert_mock_session(&sessions, "s1");
        let (tx_out, _rx_out) = mpsc::channel::<ServerMessage>(16);

        let contents = "hello world";
        let id = "abc123";
        let expected = build_edit_reply_frame(id, contents, false);

        handle_edit_reply("s1", id, contents, false, &tx_out, &sessions)
            .await
            .unwrap();

        let got = read_exact_with_timeout(reader, expected.len()).await;
        let got_str = String::from_utf8(got).expect("frame should be UTF-8");

        assert!(
            got_str.contains("\n__TERMINAR_EDIT_abc123_BEGIN__\n"),
            "frame missing BEGIN marker: {:?}",
            got_str
        );
        assert!(
            got_str.contains("\n__TERMINAR_EDIT_abc123_END__\n"),
            "frame missing END marker: {:?}",
            got_str
        );
        // Base64 of "hello world" is "aGVsbG8gd29ybGQ=".
        assert!(
            got_str.contains("aGVsbG8gd29ybGQ="),
            "frame missing expected base64: {:?}",
            got_str
        );
        // Round-trip: the bytes between BEGIN and END decode back to contents.
        let begin = got_str
            .find("\n__TERMINAR_EDIT_abc123_BEGIN__\n")
            .expect("begin marker");
        let after_begin = begin + "\n__TERMINAR_EDIT_abc123_BEGIN__\n".len();
        let end = got_str
            .find("\n__TERMINAR_EDIT_abc123_END__\n")
            .expect("end marker");
        let middle = &got_str[after_begin..end];
        let cleaned: String = middle.chars().filter(|c| *c != '\n').collect();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(cleaned.as_bytes())
            .expect("base64 decode");
        assert_eq!(String::from_utf8(decoded).unwrap(), contents);
    }

    #[tokio::test]
    async fn handle_edit_reply_cancelled_path() {
        let sessions = make_session_map();
        let reader = insert_mock_session(&sessions, "s1");
        let (tx_out, _rx_out) = mpsc::channel::<ServerMessage>(16);

        let expected = build_edit_reply_frame("abc123", "", true);
        handle_edit_reply("s1", "abc123", "", true, &tx_out, &sessions)
            .await
            .unwrap();

        let got = read_exact_with_timeout(reader, expected.len()).await;
        let got_str = String::from_utf8(got).unwrap();

        assert_eq!(got_str, "\n__TERMINAR_EDIT_abc123_CANCEL__\n");
        assert!(!got_str.contains("BEGIN"));
        assert!(!got_str.contains("END"));
    }

    #[tokio::test]
    async fn handle_edit_reply_rejects_invalid_id() {
        let sessions = make_session_map();
        let reader = insert_mock_session(&sessions, "s1");
        let (tx_out, mut rx_out) = mpsc::channel::<ServerMessage>(16);

        handle_edit_reply(
            "s1",
            "abc;rm -rf /",
            "should not be written",
            false,
            &tx_out,
            &sessions,
        )
        .await
        .unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), rx_out.recv())
            .await
            .expect("timed out waiting for error message")
            .expect("channel closed");
        match msg {
            ServerMessage::Error {
                error_code: Some(code),
                ..
            } => {
                assert_eq!(code, "EDIT_REPLY_INVALID_ID");
            }
            other => panic!("expected Error with EDIT_REPLY_INVALID_ID, got {:?}", other),
        }

        // Nothing should have been written to the PTY.
        assert_reader_empty(reader).await;
    }

    #[tokio::test]
    async fn handle_edit_reply_rejects_empty_id() {
        let sessions = make_session_map();
        let reader = insert_mock_session(&sessions, "s1");
        let (tx_out, mut rx_out) = mpsc::channel::<ServerMessage>(16);

        handle_edit_reply("s1", "", "x", false, &tx_out, &sessions)
            .await
            .unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), rx_out.recv())
            .await
            .expect("timed out")
            .expect("closed");
        match msg {
            ServerMessage::Error {
                error_code: Some(code),
                ..
            } => assert_eq!(code, "EDIT_REPLY_INVALID_ID"),
            other => panic!("expected EDIT_REPLY_INVALID_ID, got {:?}", other),
        }
        assert_reader_empty(reader).await;
    }

    #[tokio::test]
    async fn handle_edit_reply_session_not_found() {
        let sessions = make_session_map();
        // No session inserted.
        let (tx_out, mut rx_out) = mpsc::channel::<ServerMessage>(16);

        handle_edit_reply("nope", "abc123", "hello", false, &tx_out, &sessions)
            .await
            .unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), rx_out.recv())
            .await
            .expect("timed out waiting for error")
            .expect("channel closed");
        match msg {
            ServerMessage::Error {
                error_code: Some(code),
                message,
            } => {
                assert_eq!(code, "SESSION_NOT_FOUND");
                assert!(message.contains("nope"), "message should mention id");
            }
            other => panic!("expected SESSION_NOT_FOUND error, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn handle_edit_reply_wraps_base64_at_76_chars() {
        let sessions = make_session_map();
        let reader = insert_mock_session(&sessions, "s1");
        let (tx_out, _rx_out) = mpsc::channel::<ServerMessage>(16);

        // 100 bytes of contents => 136 chars of base64 (ceil(100/3)*4 = 136),
        // which spans 2 lines after 76-char wrap.
        let contents = "x".repeat(100);
        let id = "wrap1";
        let expected = build_edit_reply_frame(id, &contents, false);
        handle_edit_reply("s1", id, &contents, false, &tx_out, &sessions)
            .await
            .unwrap();

        let got = read_exact_with_timeout(reader, expected.len()).await;
        let got_str = String::from_utf8(got).unwrap();

        let begin_marker = format!("\n__TERMINAR_EDIT_{}_BEGIN__\n", id);
        let end_marker = format!("\n__TERMINAR_EDIT_{}_END__\n", id);
        let begin_idx = got_str.find(&begin_marker).expect("begin");
        let after_begin = begin_idx + begin_marker.len();
        let end_idx = got_str.find(&end_marker).expect("end");
        let middle = &got_str[after_begin..end_idx];

        // Every line between BEGIN and END must be at most 76 chars, and
        // the concatenation must round-trip back to contents.
        let mut line_count = 0;
        for line in middle.split('\n') {
            assert!(
                line.len() <= 76,
                "line exceeds 76 chars: len={} line={:?}",
                line.len(),
                line
            );
            line_count += 1;
        }
        assert!(
            line_count >= 2,
            "expected multi-line wrap, got {} line",
            line_count
        );

        let cleaned: String = middle.chars().filter(|c| *c != '\n').collect();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(cleaned.as_bytes())
            .unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), contents);
    }

    #[tokio::test]
    async fn handle_edit_reply_empty_contents_still_framed() {
        // An empty save (user cleared the editor and saved) should still
        // produce a well-formed BEGIN/END frame so the shell wrapper doesn't
        // get stuck waiting for terminators.
        let sessions = make_session_map();
        let reader = insert_mock_session(&sessions, "s1");
        let (tx_out, _rx_out) = mpsc::channel::<ServerMessage>(16);

        let id = "empty1";
        let expected = build_edit_reply_frame(id, "", false);
        handle_edit_reply("s1", id, "", false, &tx_out, &sessions)
            .await
            .unwrap();

        let got = read_exact_with_timeout(reader, expected.len()).await;
        let got_str = String::from_utf8(got).unwrap();
        assert!(got_str.contains(&format!("__TERMINAR_EDIT_{}_BEGIN__", id)));
        assert!(got_str.contains(&format!("__TERMINAR_EDIT_{}_END__", id)));
    }
}
