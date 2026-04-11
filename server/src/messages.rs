//! Protocol message types for client-server communication.
//!
//! This module re-exports core session messages from `terminar_core`
//! and defines workspace messages that remain server-specific.
//!
//! The server uses wrapper enums `ClientMessage` and `ServerMessage` that
//! combine core + server-specific variants for unified dispatch.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Re-export core types
pub use terminar_core::messages::SessionInfo;

/// Messages sent from clients (VS Code extension, web frontend) to the server.
///
/// Serialized with a `"type"` field in `snake_case` (e.g., `"create_session"`).
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ClientMessage {
    // === Core session messages (mirrored from terminar_core) ===
    /// Authenticate a WebSocket connection. Must be the first message on remote connections.
    Auth {
        /// The API token (UUID).
        token: String,
        /// Protocol version the client supports (e.g., "0.2.0").
        #[serde(skip_serializing_if = "Option::is_none")]
        protocol_version: Option<String>,
    },
    /// Request the list of all active sessions.
    ListSessions,
    /// Create a new terminal session with a PTY process.
    CreateSession {
        /// Working directory for the shell. Empty or `"/"` defaults to `$HOME`.
        cwd: String,
        /// Shell binary path. Must be in the allowed whitelist. Empty defaults to `$SHELL`.
        shell: String,
        /// Environment variables to set in the shell. Dangerous variables are filtered.
        env: HashMap<String, String>,
        /// Terminal width in columns (clamped to 1-500).
        cols: u16,
        /// Terminal height in rows (clamped to 1-500).
        rows: u16,
        /// Docker container ID for container sessions. When set, the session runs
        /// `docker exec` inside the specified container instead of a local shell.
        #[serde(skip_serializing_if = "Option::is_none")]
        container_id: Option<String>,
        /// SSH connection ID for SSH sessions. When set, the session runs
        /// `ssh user@host` to the remote host instead of a local shell.
        #[serde(skip_serializing_if = "Option::is_none")]
        ssh_connection_id: Option<String>,
    },
    /// Attach to a session to receive its output stream.
    Attach {
        /// UUID of the session to attach to.
        session_id: String,
        /// Attach mode (currently only `"mirror"` is supported).
        mode: String,
    },
    /// Send keyboard input to a session's PTY.
    Input {
        /// UUID of the target session.
        session_id: String,
        /// Raw input data including control characters.
        data: String,
    },
    /// Resize a session's terminal dimensions.
    Resize {
        /// UUID of the target session.
        session_id: String,
        /// New terminal width in columns (clamped to 1-500).
        cols: u16,
        /// New terminal height in rows (clamped to 1-500).
        rows: u16,
    },
    /// Rename an existing session.
    RenameSession {
        /// UUID of the session to rename.
        session_id: String,
        /// New display name.
        new_name: String,
    },
    /// Terminate a session and its PTY process.
    KillSession {
        /// UUID of the session to kill.
        session_id: String,
    },

    // === Docker container messages ===
    /// Request the list of running Docker containers.
    ListContainers,

    // === SSH connection messages ===
    /// Request the list of saved SSH connections.
    ListSshConnections,
    /// Add a new SSH connection.
    AddSshConnection {
        name: String,
        host: String,
        user: String,
        port: u16,
    },
    /// Update an existing SSH connection.
    UpdateSshConnection {
        id: String,
        name: String,
        host: String,
        user: String,
        port: u16,
    },
    /// Remove an SSH connection.
    RemoveSshConnection { id: String },
    /// Parse ~/.ssh/config and return importable hosts.
    ImportSshConfig,

    // === Server-specific messages (workspace) ===
    /// Save workspace data (session layout, splits, tabs, etc.).
    SaveWorkspace { workspace: serde_json::Value },
    /// Load previously saved workspace data.
    LoadWorkspace,
}

/// Messages sent from the server to connected clients.
///
/// Serialized with a `"type"` field in `PascalCase` (e.g., `"SessionList"`).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum ServerMessage {
    // === Core session messages (mirrored from terminar_core) ===
    /// List of all active sessions. Sent in response to list/create/rename/kill operations.
    SessionList { sessions: Vec<SessionInfo> },
    /// Terminal output data from a session.
    Output { session_id: String, data: String },
    /// A session has been closed (killed or shell exited).
    SessionClosed { session_id: String },
    /// An error occurred processing a client message.
    Error {
        message: String,
        /// Machine-readable error code (e.g., "SESSION_NOT_FOUND", "AUTH_FAILED").
        #[serde(skip_serializing_if = "Option::is_none")]
        error_code: Option<String>,
    },
    /// Notification that the foreground process in a session has changed.
    ForegroundChanged {
        session_id: String,
        process_name: Option<String>,
    },
    /// Notification of session activity (output, bell, or silence marker).
    SessionActivity {
        session_id: String,
        activity_type: String, // "activity", "bell", "silence"
    },
    /// Notification that a session's shell has exited.
    SessionExited {
        session_id: String,
        exit_code: Option<i32>,
    },
    /// Notification that the current working directory in a session has changed.
    CwdChanged { session_id: String, cwd: String },

    // === Docker container messages ===
    /// List of running Docker containers.
    ContainerList { containers: Vec<ContainerInfo> },

    // === SSH connection messages ===
    /// List of saved SSH connections.
    SshConnectionList { connections: Vec<SshConnectionInfo> },
    /// Result of parsing ~/.ssh/config.
    SshConfigImportResult { hosts: Vec<SshConfigHost> },

    // === Server-specific messages (auth/workspace) ===
    /// Authentication succeeded. Contains the token and protocol version.
    AuthOk {
        token: String,
        expires: String,
        /// Protocol version the server supports (e.g., "0.2.0").
        #[serde(skip_serializing_if = "Option::is_none")]
        protocol_version: Option<String>,
    },
    /// Server is shutting down gracefully. Clients should reconnect later.
    Shutdown { reason: String },
    /// Response to LoadWorkspace with saved workspace data.
    WorkspaceData {
        workspace: Option<serde_json::Value>,
    },
}

/// Information about a running Docker container.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ContainerInfo {
    /// Container ID (short form).
    pub id: String,
    /// Container name.
    pub name: String,
    /// Container image.
    pub image: String,
    /// Human-readable status (e.g., "Up 2 hours").
    pub status: String,
    /// Container state (e.g., "running").
    pub state: String,
}

/// A saved SSH connection.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SshConnectionInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub user: String,
    pub port: u16,
}

/// A host entry parsed from ~/.ssh/config.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SshConfigHost {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn test_client_message_auth() {
        let msg = ClientMessage::Auth {
            token: "abc".into(),
            protocol_version: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"auth","token":"abc"}"#);

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ClientMessage::Auth { token, .. } => assert_eq!(token, "abc"),
            _ => panic!("Wrong type"),
        }
    }

    #[test]
    fn test_client_message_list_sessions() {
        let msg = ClientMessage::ListSessions;
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"list_sessions"}"#);
    }

    #[test]
    fn test_client_message_create_session() {
        let mut env = HashMap::new();
        env.insert("FOO".into(), "BAR".into());
        let msg = ClientMessage::CreateSession {
            cwd: "/tmp".into(),
            shell: "sh".into(),
            env,
            cols: 100,
            rows: 50,
            container_id: None,
            ssh_connection_id: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"create_session""#));
        assert!(json.contains(r#""cwd":"/tmp""#));
    }

    #[test]
    fn test_client_message_input() {
        let msg = ClientMessage::Input {
            session_id: "id".into(),
            data: "ls\n".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"input","session_id":"id","data":"ls\n"}"#);
    }

    #[test]
    fn test_server_message_session_list() {
        let info = SessionInfo {
            id: "1".into(),
            name: "n".into(),
            shell: "s".into(),
            cwd: "/home".into(),
            started_at: "t".into(),
            state: None,
            foreground_process: None,
            last_activity_at: None,
            exit_code: None,
            container_id: None,
            container_name: None,
            container_image: None,
            ssh_connection_id: None,
            ssh_host: None,
            ssh_user: None,
        };
        let msg = ServerMessage::SessionList {
            sessions: vec![info],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("SessionList"));
    }

    #[test]
    fn test_server_message_output() {
        let msg = ServerMessage::Output {
            session_id: "1".into(),
            data: "d".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"Output","session_id":"1","data":"d"}"#);
    }

    #[test]
    fn test_server_message_error() {
        let msg = ServerMessage::Error {
            message: "err".into(),
            error_code: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"Error","message":"err"}"#);
    }

    #[test]
    fn test_server_message_auth_ok() {
        let msg = ServerMessage::AuthOk {
            token: "tok".into(),
            expires: "900s".into(),
            protocol_version: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"AuthOk""#));
    }

    #[test]
    fn test_server_message_foreground_changed() {
        let msg = ServerMessage::ForegroundChanged {
            session_id: "id1".into(),
            process_name: Some("vim".into()),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"ForegroundChanged""#));
        assert!(json.contains(r#""process_name":"vim""#));
    }

    #[test]
    fn test_server_message_session_exited() {
        let msg = ServerMessage::SessionExited {
            session_id: "id1".into(),
            exit_code: Some(0),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""exit_code":0"#));
    }

    #[test]
    fn test_server_message_cwd_changed() {
        let msg = ServerMessage::CwdChanged {
            session_id: "id1".into(),
            cwd: "/tmp".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"CwdChanged""#));
    }

    #[test]
    fn test_server_message_workspace_data() {
        let msg = ServerMessage::WorkspaceData { workspace: None };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"WorkspaceData""#));
    }

    #[test]
    fn test_session_info_backward_compat() {
        let old_json = r#"{"id":"1","name":"n","shell":"s","cwd":"/home","started_at":"t"}"#;
        let deserialized: SessionInfo = serde_json::from_str(old_json).unwrap();
        assert_eq!(deserialized.id, "1");
        assert_eq!(deserialized.state, None);
    }
}
