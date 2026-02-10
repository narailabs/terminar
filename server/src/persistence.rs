use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;

// Re-export from constants for backward compatibility
pub use crate::constants::DEFAULT_SESSION_FILE;

/// Metadata for a persisted session, serialized to/from JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedSession {
    pub id: String,
    pub name: String,
    pub shell_cmd: String,
    pub cwd: String,
    pub pid: Option<u32>,
    pub state: String,
}

/// Container for all persisted sessions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PersistedSessionData {
    pub sessions: Vec<PersistedSession>,
}

impl PersistedSessionData {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Resolve the session file path from CLI options.
/// If `session_file` is Some, use it. Otherwise use DEFAULT_SESSION_FILE.
pub fn resolve_session_file_path(session_file: &Option<String>) -> String {
    session_file
        .clone()
        .unwrap_or_else(|| DEFAULT_SESSION_FILE.to_string())
}

/// Atomically write data to a file using temp file + rename.
/// This prevents corruption if the process crashes mid-write.
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent()
        .ok_or_else(|| format!("No parent directory for {:?}", path))?;
    if !parent.as_os_str().is_empty() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
    }
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temp file in {:?}: {}", parent, e))?;
    tmp.write_all(data)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    tmp.flush()
        .map_err(|e| format!("Failed to flush temp file: {}", e))?;
    tmp.persist(path)
        .map_err(|e| format!("Failed to rename temp file to {:?}: {}", path, e))?;
    Ok(())
}

/// Save session data to a JSON file.
/// Creates parent directories if needed. Uses atomic write (temp + rename).
pub fn save_sessions(path: &str, data: &PersistedSessionData) -> Result<(), String> {
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize sessions: {}", e))?;
    atomic_write(Path::new(path), json.as_bytes())
}

/// Build PersistedSessionData from a SessionMap by extracting metadata.
pub fn build_persisted_data(sessions: &crate::session::SessionMap) -> PersistedSessionData {
    let guard = sessions.lock();
    let sessions_vec = guard.values().map(|s| {
        PersistedSession {
            id: s.id.clone(),
            name: s.name.clone(),
            shell_cmd: s.shell_cmd.clone(),
            cwd: s.cwd.clone(),
            pid: None, // PTY process PID is not tracked in the session struct currently
            state: format!("{:?}", s.state),
        }
    }).collect();
    PersistedSessionData { sessions: sessions_vec }
}

/// Persist current sessions to disk if persistence is enabled.
/// This is a no-op if persist_sessions is false.
pub fn persist_if_enabled(persist_sessions: bool, session_file_path: &str, sessions: &crate::session::SessionMap) {
    if !persist_sessions {
        return;
    }
    let data = build_persisted_data(sessions);
    if let Err(e) = save_sessions(session_file_path, &data) {
        tracing::warn!("Failed to persist sessions: {}", e);
    }
}

/// Load session data from a JSON file.
/// Returns empty data if file doesn't exist.
/// Returns error only if file exists but is corrupt/unreadable.
pub fn load_sessions(path: &str) -> Result<PersistedSessionData, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Ok(PersistedSessionData::new());
    }
    let contents = std::fs::read_to_string(p)
        .map_err(|e| format!("Failed to read session file {:?}: {}", path, e))?;
    serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse session file {:?}: {}", path, e))
}

// Re-export from constants for backward compatibility
pub use crate::constants::{MAX_HISTORY_FILES, HISTORY_DIR};

/// Returns the path for a session's history file.
pub fn history_file_path(base_dir: &str, session_id: &str) -> std::path::PathBuf {
    Path::new(base_dir).join(format!("{}.history", session_id))
}

/// Save history data to disk for a session.
/// Creates the directory if it doesn't exist. Uses atomic write (temp + rename).
pub fn save_history(base_dir: &str, session_id: &str, data: &[u8]) -> Result<(), String> {
    let path = history_file_path(base_dir, session_id);
    atomic_write(&path, data)
}

/// Load history data from disk for a session.
/// Returns None if the file doesn't exist.
pub fn load_history(base_dir: &str, session_id: &str) -> Result<Option<Vec<u8>>, String> {
    let path = history_file_path(base_dir, session_id);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read history file {:?}: {}", path, e))
}

/// Rotate history files, keeping only the most recent MAX_HISTORY_FILES.
/// Files are sorted by modification time, oldest deleted first.
pub fn rotate_history_files(base_dir: &str) -> Result<usize, String> {
    let dir = Path::new(base_dir);
    if !dir.exists() {
        return Ok(0);
    }

    let mut files: Vec<(std::path::PathBuf, std::time::SystemTime)> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read history directory: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("history") {
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((path, modified))
            } else {
                None
            }
        })
        .collect();

    if files.len() <= MAX_HISTORY_FILES {
        return Ok(0);
    }

    // Sort by modification time (oldest first)
    files.sort_by_key(|(_, time)| *time);

    let to_remove = files.len() - MAX_HISTORY_FILES;
    let mut removed = 0;
    for (path, _) in files.iter().take(to_remove) {
        if std::fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }

    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    // === resolve_session_file_path tests ===

    #[test]
    fn test_resolve_default_path() {
        let result = resolve_session_file_path(&None);
        assert_eq!(result, DEFAULT_SESSION_FILE);
    }

    #[test]
    fn test_resolve_custom_path() {
        let custom = Some("/tmp/my-sessions.json".to_string());
        let result = resolve_session_file_path(&custom);
        assert_eq!(result, "/tmp/my-sessions.json");
    }

    // === PersistedSession serialization tests ===

    #[test]
    fn test_persisted_session_serializes_to_json() {
        let session = PersistedSession {
            id: "abc-123".to_string(),
            name: "Terminal".to_string(),
            shell_cmd: "/bin/bash".to_string(),
            cwd: "/home/user".to_string(),
            pid: Some(1234),
            state: "Running".to_string(),
        };
        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("abc-123"));
        assert!(json.contains("/bin/bash"));
    }

    #[test]
    fn test_persisted_session_deserializes_from_json() {
        let json = r#"{"id":"abc","name":"T","shell_cmd":"/bin/sh","cwd":"/","pid":42,"state":"Running"}"#;
        let session: PersistedSession = serde_json::from_str(json).unwrap();
        assert_eq!(session.id, "abc");
        assert_eq!(session.pid, Some(42));
    }

    #[test]
    fn test_persisted_session_data_roundtrip() {
        let data = PersistedSessionData {
            sessions: vec![
                PersistedSession {
                    id: "s1".to_string(),
                    name: "Session 1".to_string(),
                    shell_cmd: "/bin/bash".to_string(),
                    cwd: "/tmp".to_string(),
                    pid: Some(100),
                    state: "Running".to_string(),
                },
                PersistedSession {
                    id: "s2".to_string(),
                    name: "Session 2".to_string(),
                    shell_cmd: "/bin/zsh".to_string(),
                    cwd: "/home".to_string(),
                    pid: None,
                    state: "Closed".to_string(),
                },
            ],
        };
        let json = serde_json::to_string(&data).unwrap();
        let restored: PersistedSessionData = serde_json::from_str(&json).unwrap();
        assert_eq!(data, restored);
    }

    // === save_sessions tests ===

    #[test]
    fn test_save_sessions_creates_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let path_str = path.to_str().unwrap();

        let data = PersistedSessionData { sessions: vec![] };
        save_sessions(path_str, &data).unwrap();

        assert!(path.exists(), "File should be created");
    }

    #[test]
    fn test_save_sessions_writes_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let path_str = path.to_str().unwrap();

        let data = PersistedSessionData {
            sessions: vec![PersistedSession {
                id: "test".to_string(),
                name: "Test".to_string(),
                shell_cmd: "/bin/sh".to_string(),
                cwd: "/".to_string(),
                pid: Some(1),
                state: "Running".to_string(),
            }],
        };
        save_sessions(path_str, &data).unwrap();

        let contents = std::fs::read_to_string(&path).unwrap();
        let loaded: PersistedSessionData = serde_json::from_str(&contents).unwrap();
        assert_eq!(loaded.sessions.len(), 1);
        assert_eq!(loaded.sessions[0].id, "test");
    }

    // === load_sessions tests ===

    #[test]
    fn test_load_sessions_missing_file_returns_empty() {
        let result = load_sessions("/tmp/nonexistent-test-file-12345.json");
        assert!(result.is_ok());
        assert_eq!(result.unwrap().sessions.len(), 0);
    }

    #[test]
    fn test_load_sessions_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.json");
        let path_str = path.to_str().unwrap();

        let data = PersistedSessionData {
            sessions: vec![PersistedSession {
                id: "loaded".to_string(),
                name: "Loaded".to_string(),
                shell_cmd: "/bin/bash".to_string(),
                cwd: "/home".to_string(),
                pid: Some(999),
                state: "Running".to_string(),
            }],
        };
        save_sessions(path_str, &data).unwrap();

        let loaded = load_sessions(path_str).unwrap();
        assert_eq!(loaded.sessions.len(), 1);
        assert_eq!(loaded.sessions[0].id, "loaded");
        assert_eq!(loaded.sessions[0].pid, Some(999));
    }

    #[test]
    fn test_load_sessions_corrupt_json_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("corrupt.json");
        std::fs::write(&path, "this is not json{{{").unwrap();

        let result = load_sessions(path.to_str().unwrap());
        assert!(result.is_err(), "Corrupt JSON should return error");
    }

    #[test]
    fn test_load_sessions_empty_file_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.json");
        std::fs::write(&path, "").unwrap();

        let result = load_sessions(path.to_str().unwrap());
        assert!(result.is_err(), "Empty file should return error");
    }

    #[test]
    fn test_save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("roundtrip.json");
        let path_str = path.to_str().unwrap();

        let data = PersistedSessionData {
            sessions: vec![
                PersistedSession {
                    id: "r1".to_string(),
                    name: "R1".to_string(),
                    shell_cmd: "/bin/bash".to_string(),
                    cwd: "/tmp".to_string(),
                    pid: Some(111),
                    state: "Running".to_string(),
                },
            ],
        };

        save_sessions(path_str, &data).unwrap();
        let loaded = load_sessions(path_str).unwrap();
        assert_eq!(data, loaded);
    }

    #[test]
    fn test_persisted_session_data_new_is_empty() {
        let data = PersistedSessionData::new();
        assert!(data.sessions.is_empty());
    }

    // === build_persisted_data tests ===

    #[test]
    fn test_build_persisted_data_empty_session_map() {
        use std::sync::Arc;
        use parking_lot::Mutex;
        use std::collections::HashMap;

        let sessions: crate::session::SessionMap = Arc::new(Mutex::new(HashMap::new()));
        let data = build_persisted_data(&sessions);
        assert!(data.sessions.is_empty());
    }

    #[test]
    fn test_build_persisted_data_with_sessions() {
        use std::sync::Arc;
        use parking_lot::Mutex;
        use std::collections::HashMap;
        use crate::pty::{MockPtyProvider, PtyProvider};
        use crate::history::CircularBuffer;
        use tokio::sync::broadcast;

        let sessions: crate::session::SessionMap = Arc::new(Mutex::new(HashMap::new()));

        // Create a mock session
        let mock_provider = MockPtyProvider;
        let master = mock_provider.create_pty(80, 24).unwrap();
        let (tx, _rx) = broadcast::channel(100);
        let history = Arc::new(Mutex::new(CircularBuffer::with_default_capacity()));
        let session = crate::session::Session::new(
            "test-id".to_string(),
            "Test Terminal".to_string(),
            "/bin/bash".to_string(),
            "/home/user".to_string(),
            master,
            tx,
            history,
        ).unwrap();
        sessions.lock().insert("test-id".to_string(), session);

        let data = build_persisted_data(&sessions);
        assert_eq!(data.sessions.len(), 1);
        assert_eq!(data.sessions[0].id, "test-id");
        assert_eq!(data.sessions[0].name, "Test Terminal");
        assert_eq!(data.sessions[0].shell_cmd, "/bin/bash");
        assert_eq!(data.sessions[0].cwd, "/home/user");
        assert_eq!(data.sessions[0].state, "Running");
    }

    // === persist_if_enabled tests ===

    #[test]
    fn test_persist_if_enabled_false_does_nothing() {
        use std::sync::Arc;
        use parking_lot::Mutex;
        use std::collections::HashMap;

        let sessions: crate::session::SessionMap = Arc::new(Mutex::new(HashMap::new()));
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("noop.json");
        let path_str = path.to_str().unwrap();

        persist_if_enabled(false, path_str, &sessions);
        assert!(!path.exists(), "File should not be created when persist is disabled");
    }

    // ==================== Task 3.3.3: History Persistence Tests ====================

    #[test]
    fn test_history_file_path() {
        let path = history_file_path("/tmp/history", "session-123");
        assert_eq!(path, std::path::PathBuf::from("/tmp/history/session-123.history"));
    }

    #[test]
    fn test_save_and_load_history() {
        let dir = tempfile::tempdir().unwrap();
        let base_dir = dir.path().to_str().unwrap();

        let data = b"terminal output data here";
        save_history(base_dir, "test-session", data).unwrap();

        let loaded = load_history(base_dir, "test-session").unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap(), data.to_vec());
    }

    #[test]
    fn test_load_history_missing_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let base_dir = dir.path().to_str().unwrap();

        let loaded = load_history(base_dir, "nonexistent").unwrap();
        assert!(loaded.is_none(), "Loading missing history should return None");
    }

    #[test]
    fn test_save_history_creates_directory() {
        let dir = tempfile::tempdir().unwrap();
        let base_dir = dir.path().join("subdir").join("history");
        let base_dir_str = base_dir.to_str().unwrap();

        save_history(base_dir_str, "test", b"data").unwrap();
        assert!(base_dir.exists(), "Directory should be created");
    }

    #[test]
    fn test_rotate_history_files_noop_when_under_limit() {
        let dir = tempfile::tempdir().unwrap();
        let base_dir = dir.path().to_str().unwrap();

        // Create fewer than MAX_HISTORY_FILES
        for i in 0..3 {
            save_history(base_dir, &format!("session-{}", i), b"data").unwrap();
        }

        let removed = rotate_history_files(base_dir).unwrap();
        assert_eq!(removed, 0, "No files should be removed when under limit");
    }

    #[test]
    fn test_rotate_history_files_removes_oldest() {
        let dir = tempfile::tempdir().unwrap();
        let base_dir = dir.path().to_str().unwrap();

        // Create more than MAX_HISTORY_FILES
        for i in 0..(MAX_HISTORY_FILES + 3) {
            save_history(base_dir, &format!("session-{}", i), b"data").unwrap();
            // Small sleep to ensure different modification times
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let removed = rotate_history_files(base_dir).unwrap();
        assert_eq!(removed, 3, "3 oldest files should be removed");

        // Count remaining .history files
        let remaining: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("history"))
            .collect();
        assert_eq!(remaining.len(), MAX_HISTORY_FILES,
            "Should keep exactly MAX_HISTORY_FILES files");
    }

    #[test]
    fn test_rotate_history_files_nonexistent_dir() {
        let removed = rotate_history_files("/tmp/nonexistent-rotation-test-dir-12345").unwrap();
        assert_eq!(removed, 0, "Non-existent directory should return 0");
    }

    #[test]
    fn test_max_history_files_constant() {
        assert_eq!(MAX_HISTORY_FILES, 5);
    }

    #[test]
    fn test_persist_if_enabled_true_creates_file() {
        use std::sync::Arc;
        use parking_lot::Mutex;
        use std::collections::HashMap;

        let sessions: crate::session::SessionMap = Arc::new(Mutex::new(HashMap::new()));
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("persist.json");
        let path_str = path.to_str().unwrap();

        persist_if_enabled(true, path_str, &sessions);
        assert!(path.exists(), "File should be created when persist is enabled");

        let loaded = load_sessions(path_str).unwrap();
        assert!(loaded.sessions.is_empty());
    }
}
