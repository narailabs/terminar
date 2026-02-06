//! Protocol message types for client-server communication.
//!
//! Messages are serialized as JSON with a `type` discriminant field.
//! Client messages use `snake_case` tags; server messages use `PascalCase` tags.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Messages sent from clients (VS Code extension, web frontend) to the server.
///
/// Serialized with a `"type"` field in `snake_case` (e.g., `"create_session"`).
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ClientMessage {
    /// Authenticate a WebSocket connection. Must be the first message on remote connections.
    Auth {
        /// The API token (UUID).
        token: String,
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
    /// Request a pairing code for remote client authentication.
    PairRequest,
    /// Authenticate with OS username and password (PAM).
    AuthPassword {
        username: String,
        password: String,
    },
    /// Initiate SSH public key authentication (step 1: send pubkey).
    AuthPubkeyInit {
        username: String,
        pubkey: String,
    },
    /// Complete SSH public key authentication (step 2: verify signature).
    AuthPubkeyVerify {
        signature: String,
        algorithm: String,
    },
    /// Authenticate with a previously issued JWT token (reconnection).
    AuthToken {
        token: String,
    },
    /// Save workspace data (session layout, splits, tabs, etc.).
    SaveWorkspace {
        workspace: serde_json::Value,
    },
    /// Load previously saved workspace data.
    LoadWorkspace,
}

/// Messages sent from the server to connected clients.
///
/// Serialized with a `"type"` field in `PascalCase` (e.g., `"SessionList"`).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum ServerMessage {
    /// List of all active sessions. Sent in response to list/create/rename/kill operations.
    SessionList { sessions: Vec<SessionInfo> },
    /// Terminal output data from a session.
    Output { session_id: String, data: String },
    /// A session has been closed (killed or shell exited).
    SessionClosed { session_id: String },
    /// An error occurred processing a client message.
    Error { message: String },
    /// Response to a pairing request with a generated code.
    PairResponse { code: String, expiry_secs: u64 },
    /// Server is shutting down gracefully. Clients should reconnect later.
    Shutdown { reason: String },
    /// Authentication succeeded. Contains a JWT for reconnection.
    AuthOk {
        token: String,
        expires: String,
    },
    /// SSH public key challenge. Client must sign this nonce with their private key.
    AuthChallenge {
        nonce: String,
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
    CwdChanged {
        session_id: String,
        cwd: String,
    },
    /// Response to LoadWorkspace with saved workspace data.
    WorkspaceData {
        workspace: Option<serde_json::Value>,
    },
}

/// Information about an active terminal session.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionInfo {
    /// Unique session identifier (UUID).
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Shell binary path (e.g., `/bin/bash`).
    pub shell: String,
    /// Working directory.
    pub cwd: String,
    /// When the session was started.
    pub started_at: String,
    /// Current state of the session ("creating", "running", "closing", "closed", "exited", "error").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    /// Name of the foreground process (e.g., "vim", "claude").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub foreground_process: Option<String>,
    /// Timestamp of last activity (output, bell, or silence marker).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
    /// Exit code if the shell has exited.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

#[cfg(test)]
mod tests {

    use super::*;



    #[test]

    fn test_client_message_auth() {

        let msg = ClientMessage::Auth { token: "abc".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"auth","token":"abc"}"#);

        

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();

        match deserialized {

            ClientMessage::Auth { token } => assert_eq!(token, "abc"),

            _ => panic!("Wrong type"),

        }

    }



    #[test]

    fn test_client_message_list_sessions() {

        let msg = ClientMessage::ListSessions;

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"list_sessions"}"#);

        

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();

        match deserialized {

            ClientMessage::ListSessions => {},

            _ => panic!("Wrong type"),

        }

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

        };

        let json = serde_json::to_string(&msg).unwrap();

        assert!(json.contains(r#""type":"create_session""#));

        assert!(json.contains(r#""cwd":"/tmp""#));

        assert!(json.contains(r#""FOO":"BAR""#));

        assert!(json.contains(r#""cols":100"#));



        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();

        match deserialized {

            ClientMessage::CreateSession { cwd, shell, cols, .. } => {

                assert_eq!(cwd, "/tmp");

                assert_eq!(shell, "sh");

                assert_eq!(cols, 100);

            },

            _ => panic!("Wrong type"),

        }

    }



    #[test]

    fn test_client_message_attach() {

        let msg = ClientMessage::Attach { session_id: "id".into(), mode: "rw".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"attach","session_id":"id","mode":"rw"}"#);

    }



    #[test]

    fn test_client_message_input() {

        let msg = ClientMessage::Input { session_id: "id".into(), data: "ls\n".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"input","session_id":"id","data":"ls\n"}"#);

    }



    #[test]

    fn test_client_message_resize() {

        let msg = ClientMessage::Resize { session_id: "id".into(), cols: 10, rows: 10 };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"resize","session_id":"id","cols":10,"rows":10}"#);

    }



    #[test]

    fn test_client_message_rename() {

        let msg = ClientMessage::RenameSession { session_id: "id".into(), new_name: "prod".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"rename_session","session_id":"id","new_name":"prod"}"#);

    }



    #[test]

    fn test_client_message_kill() {

        let msg = ClientMessage::KillSession { session_id: "id".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"kill_session","session_id":"id"}"#);

    }



    #[test]

    fn test_client_message_pair_request() {

        let msg = ClientMessage::PairRequest;

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"pair_request"}"#);

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
        };

        let msg = ServerMessage::SessionList { sessions: vec![info] };

        let json = serde_json::to_string(&msg).unwrap();

        assert!(json.contains("SessionList"));

        assert!(json.contains("sessions"));

    }



    #[test]

    fn test_server_message_output() {

        let msg = ServerMessage::Output { session_id: "1".into(), data: "d".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"Output","session_id":"1","data":"d"}"#);

    }



    #[test]

    fn test_server_message_session_closed() {

        let msg = ServerMessage::SessionClosed { session_id: "1".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"SessionClosed","session_id":"1"}"#);

    }



    #[test]

    fn test_server_message_error() {

        let msg = ServerMessage::Error { message: "err".into() };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"Error","message":"err"}"#);

    }



    #[test]

    fn test_server_message_pair_response() {

        let msg = ServerMessage::PairResponse { code: "123".into(), expiry_secs: 60 };

        let json = serde_json::to_string(&msg).unwrap();

        assert_eq!(json, r#"{"type":"PairResponse","code":"123","expiry_secs":60}"#);

    }

    #[test]
    fn test_client_message_auth_password() {
        let msg = ClientMessage::AuthPassword {
            username: "narayan".into(),
            password: "secret".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"auth_password""#));
        assert!(json.contains(r#""username":"narayan""#));
        assert!(json.contains(r#""password":"secret""#));

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ClientMessage::AuthPassword { username, password } => {
                assert_eq!(username, "narayan");
                assert_eq!(password, "secret");
            },
            _ => panic!("Wrong type"),
        }
    }

    #[test]
    fn test_client_message_auth_pubkey_init() {
        let msg = ClientMessage::AuthPubkeyInit {
            username: "narayan".into(),
            pubkey: "c3NoLWVkMjU1MTk=".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"auth_pubkey_init""#));

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ClientMessage::AuthPubkeyInit { username, pubkey } => {
                assert_eq!(username, "narayan");
                assert_eq!(pubkey, "c3NoLWVkMjU1MTk=");
            },
            _ => panic!("Wrong type"),
        }
    }

    #[test]
    fn test_client_message_auth_pubkey_verify() {
        let msg = ClientMessage::AuthPubkeyVerify {
            signature: "sig-base64".into(),
            algorithm: "ssh-ed25519".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"auth_pubkey_verify""#));

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ClientMessage::AuthPubkeyVerify { signature, algorithm } => {
                assert_eq!(signature, "sig-base64");
                assert_eq!(algorithm, "ssh-ed25519");
            },
            _ => panic!("Wrong type"),
        }
    }

    #[test]
    fn test_client_message_auth_token() {
        let msg = ClientMessage::AuthToken {
            token: "eyJhbGciOiJIUzI1NiJ9.test.sig".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"auth_token""#));
    }

    #[test]
    fn test_server_message_auth_ok_with_jwt() {
        let msg = ServerMessage::AuthOk {
            token: "eyJhbGciOiJIUzI1NiJ9.test.sig".into(),
            expires: "2026-01-30T06:42:08Z".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"AuthOk""#));
        assert!(json.contains(r#""token":"#));
        assert!(json.contains(r#""expires":"#));

        let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ServerMessage::AuthOk { token, expires } => {
                assert!(token.starts_with("eyJ"));
                assert!(expires.contains("2026"));
            },
            _ => panic!("Expected AuthOk"),
        }
    }

    #[test]
    fn test_server_message_auth_challenge() {
        let msg = ServerMessage::AuthChallenge {
            nonce: "random-nonce-base64".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"AuthChallenge","nonce":"random-nonce-base64"}"#);

        let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ServerMessage::AuthChallenge { nonce } => {
                assert_eq!(nonce, "random-nonce-base64");
            },
            _ => panic!("Expected AuthChallenge"),
        }
    }

    #[test]
    fn test_server_message_shutdown() {
        let msg = ServerMessage::Shutdown { reason: "Server restarting".into() };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"Shutdown","reason":"Server restarting"}"#);

        // Test deserialization
        let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ServerMessage::Shutdown { reason } => {
                assert_eq!(reason, "Server restarting");
            },
            _ => panic!("Expected Shutdown message"),
        }
    }

    // ==================== SessionInfo Extended Fields Tests ====================

    #[test]
    fn test_session_info_with_foreground_process() {
        let info = SessionInfo {
            id: "1".into(),
            name: "n".into(),
            shell: "s".into(),
            cwd: "/home".into(),
            started_at: "t".into(),
            state: Some("running".into()),
            foreground_process: Some("claude".into()),
            last_activity_at: None,
            exit_code: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""foreground_process":"claude""#));
        assert!(json.contains(r#""state":"running""#));

        let deserialized: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.foreground_process, Some("claude".into()));
    }

    #[test]
    fn test_session_info_foreground_process_none_omitted() {
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
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("foreground_process"), "None should be omitted from JSON");
        assert!(!json.contains("state"), "None should be omitted from JSON");
    }

    #[test]
    fn test_session_info_with_state() {
        let info = SessionInfo {
            id: "1".into(),
            name: "n".into(),
            shell: "s".into(),
            cwd: "/home".into(),
            started_at: "t".into(),
            state: Some("running".into()),
            foreground_process: None,
            last_activity_at: None,
            exit_code: None,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""state":"running""#));
    }

    #[test]
    fn test_session_info_with_exit_code() {
        let info = SessionInfo {
            id: "1".into(),
            name: "n".into(),
            shell: "s".into(),
            cwd: "/home".into(),
            started_at: "t".into(),
            state: Some("exited".into()),
            foreground_process: None,
            last_activity_at: None,
            exit_code: Some(0),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains(r#""exit_code":0"#));

        let deserialized: SessionInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.exit_code, Some(0));
    }

    #[test]
    fn test_session_info_backward_compat() {
        // Old SessionInfo JSON without new fields should deserialize
        let old_json = r#"{"id":"1","name":"n","shell":"s","cwd":"/home","started_at":"t"}"#;
        let deserialized: SessionInfo = serde_json::from_str(old_json).unwrap();
        assert_eq!(deserialized.id, "1");
        assert_eq!(deserialized.state, None);
        assert_eq!(deserialized.foreground_process, None);
        assert_eq!(deserialized.last_activity_at, None);
        assert_eq!(deserialized.exit_code, None);
    }

    // ==================== New ServerMessage Variants Tests ====================

    #[test]
    fn test_server_message_foreground_changed_with_process() {
        let msg = ServerMessage::ForegroundChanged {
            session_id: "id1".into(),
            process_name: Some("vim".into()),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"ForegroundChanged""#));
        assert!(json.contains(r#""session_id":"id1""#));
        assert!(json.contains(r#""process_name":"vim""#));

        let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ServerMessage::ForegroundChanged { session_id, process_name } => {
                assert_eq!(session_id, "id1");
                assert_eq!(process_name, Some("vim".into()));
            },
            _ => panic!("Expected ForegroundChanged"),
        }
    }

    #[test]
    fn test_server_message_foreground_changed_with_null() {
        let msg = ServerMessage::ForegroundChanged {
            session_id: "id1".into(),
            process_name: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""process_name":null"#), "None should serialize as null, not skip field");
    }

    #[test]
    fn test_server_message_session_activity_activity() {
        let msg = ServerMessage::SessionActivity {
            session_id: "id1".into(),
            activity_type: "activity".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"SessionActivity""#));
        assert!(json.contains(r#""activity_type":"activity""#));
    }

    #[test]
    fn test_server_message_session_activity_bell() {
        let msg = ServerMessage::SessionActivity {
            session_id: "id1".into(),
            activity_type: "bell".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""activity_type":"bell""#));
    }

    #[test]
    fn test_server_message_session_exited_with_exit_code() {
        let msg = ServerMessage::SessionExited {
            session_id: "id1".into(),
            exit_code: Some(0),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"SessionExited""#));
        assert!(json.contains(r#""exit_code":0"#));
    }

    #[test]
    fn test_server_message_session_exited_with_null_exit_code() {
        let msg = ServerMessage::SessionExited {
            session_id: "id1".into(),
            exit_code: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""exit_code":null"#));
    }

    #[test]
    fn test_server_message_workspace_data_with_value() {
        let workspace = serde_json::json!({"sessions": ["id1", "id2"]});
        let msg = ServerMessage::WorkspaceData {
            workspace: Some(workspace.clone()),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"WorkspaceData""#));
        assert!(json.contains(r#""sessions""#));

        let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ServerMessage::WorkspaceData { workspace } => {
                assert!(workspace.is_some());
            },
            _ => panic!("Expected WorkspaceData"),
        }
    }

    #[test]
    fn test_server_message_workspace_data_with_none() {
        let msg = ServerMessage::WorkspaceData {
            workspace: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"WorkspaceData""#));
        assert!(json.contains(r#""workspace":null"#));
    }

    #[test]
    fn test_server_message_cwd_changed() {
        let msg = ServerMessage::CwdChanged {
            session_id: "id1".into(),
            cwd: "/tmp".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"CwdChanged""#));
        assert!(json.contains(r#""session_id":"id1""#));
        assert!(json.contains(r#""cwd":"/tmp""#));

        let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ServerMessage::CwdChanged { session_id, cwd } => {
                assert_eq!(session_id, "id1");
                assert_eq!(cwd, "/tmp");
            },
            _ => panic!("Expected CwdChanged"),
        }
    }

    // ==================== New ClientMessage Variants Tests ====================

    #[test]
    fn test_client_message_save_workspace() {
        let workspace = serde_json::json!({"sessions": ["id1"]});
        let msg = ClientMessage::SaveWorkspace {
            workspace: workspace.clone(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"save_workspace""#));
        assert!(json.contains(r#""sessions""#));

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ClientMessage::SaveWorkspace { workspace: w } => {
                assert_eq!(w, workspace);
            },
            _ => panic!("Expected SaveWorkspace"),
        }
    }

    #[test]
    fn test_client_message_load_workspace() {
        let msg = ClientMessage::LoadWorkspace;
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"load_workspace"}"#);

        let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            ClientMessage::LoadWorkspace => {},
            _ => panic!("Expected LoadWorkspace"),
        }
    }

}
