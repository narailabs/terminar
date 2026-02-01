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

        let info = SessionInfo { id: "1".into(), name: "n".into(), shell: "s".into(), cwd: "/home".into(), started_at: "t".into() };

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

}
