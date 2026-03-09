//! Workspace persistence handlers: SaveWorkspace, LoadWorkspace.
//!
//! Stores per-client workspace JSON in `~/.terminar/workspaces/<client-id>.json`.
//! Client ID is derived from the authenticated token/connection identifier.

use crate::messages::ServerMessage;

use std::fs;
use std::io;
use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::{error, info, instrument, warn};

/// Maximum workspace payload size: 1MB
const MAX_WORKSPACE_SIZE: usize = 1_048_576;

/// Returns the path to the workspaces directory (`~/.terminar/workspaces/`)
pub fn get_workspaces_dir() -> PathBuf {
    crate::settings::get_settings_dir().join("workspaces")
}

/// Returns the path to a specific client's workspace file.
///
/// The client_id is sanitized to prevent path traversal attacks:
/// only alphanumeric characters, hyphens, and underscores are allowed.
pub fn get_workspace_path(client_id: &str) -> PathBuf {
    let safe_id = sanitize_client_id(client_id);
    get_workspaces_dir().join(format!("{}.json", safe_id))
}

/// Sanitize a client ID to be safe for use as a filename.
/// Replaces any characters that are not alphanumeric, hyphens, or underscores with underscores.
fn sanitize_client_id(client_id: &str) -> String {
    client_id
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Save workspace data to disk for a specific client.
///
/// Writes atomically: write to a temp file first, then rename to the final path.
/// Creates the workspaces directory if it doesn't exist.
pub fn save_workspace_to_disk(
    client_id: &str,
    workspace: &serde_json::Value,
) -> Result<(), io::Error> {
    let dir = get_workspaces_dir();
    let path = get_workspace_path(client_id);

    // Create directory if it doesn't exist
    if !dir.exists() {
        fs::create_dir_all(&dir)?;

        // Set directory permissions to 0700 (owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
    }

    // Serialize to pretty JSON
    let json = serde_json::to_string_pretty(workspace).map_err(io::Error::other)?;

    // Atomic write: write to temp file, then rename
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, &json)?;

    // Set file permissions to 0600 (owner read/write only) before renaming
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))?;
    }

    fs::rename(&temp_path, &path)?;

    info!(client_id = %client_id, path = ?path, "Saved workspace to disk");
    Ok(())
}

/// Load workspace data from disk for a specific client.
///
/// Returns `None` if no workspace file exists for the client.
pub fn load_workspace_from_disk(client_id: &str) -> Result<Option<serde_json::Value>, io::Error> {
    let path = get_workspace_path(client_id);

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(workspace) => {
                info!(client_id = %client_id, "Loaded workspace from disk");
                Ok(Some(workspace))
            }
            Err(e) => {
                warn!(client_id = %client_id, error = %e, "Failed to parse workspace file");
                Err(io::Error::other(format!(
                    "Failed to parse workspace: {}",
                    e
                )))
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            info!(client_id = %client_id, "No workspace file found");
            Ok(None)
        }
        Err(e) => {
            error!(client_id = %client_id, error = %e, "Failed to read workspace file");
            Err(e)
        }
    }
}

/// Handle SaveWorkspace message.
///
/// Validates payload size (max 1MB), stores workspace JSON to disk keyed by client_id.
#[instrument(skip(workspace, tx_out), fields(client_id = %client_id))]
pub(crate) async fn handle_save_workspace(
    client_id: &str,
    workspace: &serde_json::Value,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Validate payload size
    let payload_size = serde_json::to_string(workspace)
        .map(|s| s.len())
        .unwrap_or(0);

    if payload_size > MAX_WORKSPACE_SIZE {
        let msg = format!(
            "Workspace payload too large: {} bytes (max {} bytes)",
            payload_size, MAX_WORKSPACE_SIZE
        );
        warn!("{}", msg);
        tx_out
            .send(ServerMessage::Error {
                message: msg,
                error_code: Some("INVALID_INPUT".to_string()),
            })
            .await?;
        return Ok(());
    }

    // Save to disk
    match save_workspace_to_disk(client_id, workspace) {
        Ok(()) => {
            // Return the saved workspace data as confirmation
            tx_out
                .send(ServerMessage::WorkspaceData {
                    workspace: Some(workspace.clone()),
                })
                .await?;
        }
        Err(e) => {
            let msg = format!("Failed to save workspace: {}", e);
            error!("{}", msg);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("INTERNAL_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

/// Handle LoadWorkspace message.
///
/// Reads workspace data from disk for the given client_id.
/// Returns `WorkspaceData { workspace: None }` if no saved workspace exists.
#[instrument(skip(tx_out), fields(client_id = %client_id))]
pub(crate) async fn handle_load_workspace(
    client_id: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    match load_workspace_from_disk(client_id) {
        Ok(workspace) => {
            tx_out
                .send(ServerMessage::WorkspaceData { workspace })
                .await?;
        }
        Err(e) => {
            let msg = format!("Failed to load workspace: {}", e);
            error!("{}", msg);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("INTERNAL_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tokio::sync::mpsc;

    /// Helper to create a test workspace directory using a temp dir.
    /// Sets HOME env var to redirect `get_workspaces_dir()`.
    /// Returns (TempDir, original_home) - caller must restore HOME when done.
    fn setup_test_dir() -> (tempfile::TempDir, String) {
        let original_home = std::env::var("HOME").unwrap_or_default();
        let tmp = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("HOME", tmp.path()) };
        (tmp, original_home)
    }

    /// Restore HOME env var after test
    fn teardown_test_dir(original_home: &str) {
        unsafe { std::env::set_var("HOME", original_home) };
    }

    #[tokio::test]
    #[serial]
    async fn test_save_workspace_stores_data_on_disk() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-client-1";
        let workspace = serde_json::json!({
            "tabs": [{"id": "tab1", "name": "Main"}],
            "activeTabId": "tab1"
        });

        let (tx, mut rx) = mpsc::channel(32);
        handle_save_workspace(client_id, &workspace, &tx)
            .await
            .unwrap();

        // Check response
        let msg = rx.recv().await.unwrap();
        match msg {
            ServerMessage::WorkspaceData { workspace: Some(w) } => {
                assert_eq!(w["activeTabId"], "tab1");
            }
            other => panic!("Expected WorkspaceData, got {:?}", other),
        }

        // Verify file exists on disk
        let path = get_workspace_path(client_id);
        assert!(path.exists(), "Workspace file should exist on disk");

        // Verify file contents
        let content = fs::read_to_string(&path).unwrap();
        let saved: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(saved["activeTabId"], "tab1");
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_load_workspace_returns_stored_data() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-client-2";
        let workspace = serde_json::json!({
            "tabs": [{"id": "tab1", "name": "Main"}],
            "activeTabId": "tab1"
        });

        // Save first
        let (tx, mut rx) = mpsc::channel(32);
        handle_save_workspace(client_id, &workspace, &tx)
            .await
            .unwrap();
        let _ = rx.recv().await; // consume save response

        // Load
        handle_load_workspace(client_id, &tx).await.unwrap();
        let msg = rx.recv().await.unwrap();
        match msg {
            ServerMessage::WorkspaceData { workspace: Some(w) } => {
                assert_eq!(w["activeTabId"], "tab1");
                assert_eq!(w["tabs"][0]["name"], "Main");
            }
            other => panic!("Expected WorkspaceData with data, got {:?}", other),
        }
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_load_workspace_returns_none_when_no_data_saved() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "nonexistent-client";

        let (tx, mut rx) = mpsc::channel(32);
        handle_load_workspace(client_id, &tx).await.unwrap();

        let msg = rx.recv().await.unwrap();
        match msg {
            ServerMessage::WorkspaceData { workspace: None } => {
                // Expected
            }
            other => panic!("Expected WorkspaceData with None, got {:?}", other),
        }
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_oversized_workspace_rejected() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-client-big";

        // Create a workspace larger than 1MB
        let large_string = "x".repeat(MAX_WORKSPACE_SIZE + 1);
        let workspace = serde_json::json!({ "data": large_string });

        let (tx, mut rx) = mpsc::channel(32);
        handle_save_workspace(client_id, &workspace, &tx)
            .await
            .unwrap();

        let msg = rx.recv().await.unwrap();
        match msg {
            ServerMessage::Error {
                message,
                error_code,
            } => {
                assert!(
                    message.contains("too large"),
                    "Error should mention size: {}",
                    message
                );
                assert_eq!(error_code, Some("INVALID_INPUT".to_string()));
            }
            other => panic!("Expected Error message, got {:?}", other),
        }

        // Verify no file was saved
        let path = get_workspace_path(client_id);
        assert!(
            !path.exists(),
            "Oversized workspace should not be saved to disk"
        );
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_workspace_persists_across_function_calls() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-client-persist";
        let workspace = serde_json::json!({
            "tabs": [{"id": "tab1", "name": "Persistent"}],
            "activeTabId": "tab1"
        });

        // Save with one channel
        {
            let (tx, mut rx) = mpsc::channel(32);
            handle_save_workspace(client_id, &workspace, &tx)
                .await
                .unwrap();
            let _ = rx.recv().await;
        }

        // Load with a completely new channel (simulates restart)
        {
            let (tx, mut rx) = mpsc::channel(32);
            handle_load_workspace(client_id, &tx).await.unwrap();
            let msg = rx.recv().await.unwrap();
            match msg {
                ServerMessage::WorkspaceData { workspace: Some(w) } => {
                    assert_eq!(w["tabs"][0]["name"], "Persistent");
                }
                other => panic!("Expected WorkspaceData, got {:?}", other),
            }
        }
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_workspace_stored_per_client() {
        let (_tmp, original_home) = setup_test_dir();

        let workspace_a = serde_json::json!({"owner": "client-a"});
        let workspace_b = serde_json::json!({"owner": "client-b"});

        let (tx, mut rx) = mpsc::channel(32);

        // Save for client A
        handle_save_workspace("client-a", &workspace_a, &tx)
            .await
            .unwrap();
        let _ = rx.recv().await;

        // Save for client B
        handle_save_workspace("client-b", &workspace_b, &tx)
            .await
            .unwrap();
        let _ = rx.recv().await;

        // Load for client A - should get A's data
        handle_load_workspace("client-a", &tx).await.unwrap();
        let msg = rx.recv().await.unwrap();
        match msg {
            ServerMessage::WorkspaceData { workspace: Some(w) } => {
                assert_eq!(w["owner"], "client-a");
            }
            other => panic!("Expected client-a workspace, got {:?}", other),
        }

        // Load for client B - should get B's data
        handle_load_workspace("client-b", &tx).await.unwrap();
        let msg = rx.recv().await.unwrap();
        match msg {
            ServerMessage::WorkspaceData { workspace: Some(w) } => {
                assert_eq!(w["owner"], "client-b");
            }
            other => panic!("Expected client-b workspace, got {:?}", other),
        }
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_workspace_file_stored_at_correct_path() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-path-client";
        let workspace = serde_json::json!({"test": true});

        let (tx, mut rx) = mpsc::channel(32);
        handle_save_workspace(client_id, &workspace, &tx)
            .await
            .unwrap();
        let _ = rx.recv().await;

        let expected_path = get_workspaces_dir().join("test-path-client.json");
        assert!(
            expected_path.exists(),
            "File should be at {:?}",
            expected_path
        );
        teardown_test_dir(&original_home);
    }

    #[test]
    fn test_sanitize_client_id() {
        assert_eq!(sanitize_client_id("simple-id"), "simple-id");
        assert_eq!(
            sanitize_client_id("id_with_underscores"),
            "id_with_underscores"
        );
        assert_eq!(sanitize_client_id("abc123"), "abc123");
        // ../../../etc/passwd -> each . and / becomes _
        // . . / . . / . . / e t c / p a s s w d
        // _ _ _ _ _ _ _ _ _ e t c _ p a s s w d
        assert_eq!(
            sanitize_client_id("../../../etc/passwd"),
            "_________etc_passwd"
        );
        assert_eq!(sanitize_client_id("id with spaces"), "id_with_spaces");
        assert_eq!(sanitize_client_id("id/with/slashes"), "id_with_slashes");
    }

    #[test]
    #[serial]
    fn test_get_workspaces_dir() {
        let (_tmp, original_home) = setup_test_dir();
        let dir = get_workspaces_dir();
        assert!(dir.ends_with(".terminar/workspaces"));
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_save_workspace_creates_directory() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-dir-creation";
        let workspace = serde_json::json!({"test": true});

        // Ensure the directory doesn't exist yet
        let dir = get_workspaces_dir();
        assert!(!dir.exists());

        let (tx, mut rx) = mpsc::channel(32);
        handle_save_workspace(client_id, &workspace, &tx)
            .await
            .unwrap();
        let _ = rx.recv().await;

        // Directory should now exist
        assert!(dir.exists(), "Workspaces directory should be created");
        teardown_test_dir(&original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_atomic_write_no_partial_files() {
        let (_tmp, original_home) = setup_test_dir();
        let client_id = "test-atomic";
        let workspace = serde_json::json!({"data": "complete"});

        save_workspace_to_disk(client_id, &workspace).unwrap();

        // Verify no .tmp file exists (rename should have cleaned it up)
        let tmp_path = get_workspace_path(client_id).with_extension("json.tmp");
        assert!(
            !tmp_path.exists(),
            "Temp file should not remain after atomic write"
        );

        // Verify the final file has complete content
        let content = fs::read_to_string(get_workspace_path(client_id)).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed["data"], "complete");
        teardown_test_dir(&original_home);
    }
}
