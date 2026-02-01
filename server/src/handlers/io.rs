//! I/O message handlers: Input, Resize, Attach.

use crate::handlers::session::clamp_dimension;
use crate::messages::ServerMessage;
use crate::session::{SessionEvent, SessionMap};

use portable_pty::PtySize;
use tokio::sync::mpsc;
use tracing::{info, error, instrument};

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
                Err(format!("Session '{}' is not accepting input (state: {:?})", session_id, session.state))
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
        tx_out.send(ServerMessage::Error { message: message.clone() }).await?;
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
            let _ = master_guard.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
            true
        } else {
            false
        }
    };
    if !found {
        tx_out.send(ServerMessage::Error {
            message: format!("Session '{}' not found", session_id)
        }).await?;
    }
    Ok(())
}

/// Map of session_id → forwarding task handle, used to cancel old forwarders on re-attach.
pub type AttachTasks = std::collections::HashMap<String, tokio::task::JoinHandle<()>>;

/// Handle Attach message.
#[instrument(skip(tx_out, sessions, attach_tasks), fields(session_id = %session_id))]
pub(crate) async fn handle_attach(
    session_id: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
    sessions: &SessionMap,
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
            // The reader now properly handles UTF-8 boundaries for live output,
            // but history replay may have a truncated start.
            Some((String::from_utf8_lossy(&raw).to_string(), session.output_tx.subscribe()))
        } else {
            None
        }
    };

    if let Some((history_data, mut rx)) = history_data_opt {
        info!(session_id = %session_id, event = "session_attached", "Session lifecycle: attached");
        tx_out.send(ServerMessage::Output {
            session_id: session_id.to_string(),
            data: history_data
        }).await?;

        let tx_out_clone = tx_out.clone();
        let session_id_clone = session_id.to_string();

        let handle = tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                match event {
                    SessionEvent::Output(data) => {
                        if tx_out_clone.send(ServerMessage::Output {
                            session_id: session_id_clone.clone(),
                            data
                        }).await.is_err() {
                            break;
                        }
                    },
                    SessionEvent::Closed => {
                        let _ = tx_out_clone.send(ServerMessage::SessionClosed {
                            session_id: session_id_clone.clone()
                        }).await;
                        break;
                    },
                    SessionEvent::Exited(exit_code) => {
                        let _ = tx_out_clone.send(ServerMessage::SessionExited {
                            session_id: session_id_clone.clone(),
                            exit_code,
                        }).await;
                        break;
                    },
                    SessionEvent::Bell => {
                        let _ = tx_out_clone.send(ServerMessage::SessionActivity {
                            session_id: session_id_clone.clone(),
                            activity_type: "bell".to_string(),
                        }).await;
                    },
                    SessionEvent::Activity => {
                        let _ = tx_out_clone.send(ServerMessage::SessionActivity {
                            session_id: session_id_clone.clone(),
                            activity_type: "activity".to_string(),
                        }).await;
                    },
                    SessionEvent::Silence => {
                        let _ = tx_out_clone.send(ServerMessage::SessionActivity {
                            session_id: session_id_clone.clone(),
                            activity_type: "silence".to_string(),
                        }).await;
                    },
                    SessionEvent::ForegroundChanged(process_name) => {
                        let _ = tx_out_clone.send(ServerMessage::ForegroundChanged {
                            session_id: session_id_clone.clone(),
                            process_name,
                        }).await;
                    },
                }
            }
        });
        attach_tasks.insert(session_id.to_string(), handle);
    }
    Ok(())
}
