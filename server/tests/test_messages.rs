use std::collections::HashMap;
use terminar_server::messages::{ClientMessage, ServerMessage, SessionInfo};

#[test]
fn test_client_message_serialization() {
    // 1. CreateSession
    let create_msg = ClientMessage::CreateSession {
        cwd: "/".to_string(),
        shell: "bash".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
        container_id: None,
        ssh_connection_id: None,
    };
    let json = serde_json::to_string(&create_msg).unwrap();
    assert_eq!(
        json,
        r#"{"type":"create_session","cwd":"/","shell":"bash","env":{},"cols":80,"rows":24}"#
    );

    // 2. Attach
    let attach_msg = ClientMessage::Attach {
        session_id: "123".to_string(),
        mode: "mirror".to_string(),
    };
    let json = serde_json::to_string(&attach_msg).unwrap();
    assert_eq!(
        json,
        r#"{"type":"attach","session_id":"123","mode":"mirror"}"#
    );

    // 3. Input
    let input_msg = ClientMessage::Input {
        session_id: "123".to_string(),
        data: "ls".to_string(),
    };
    let json = serde_json::to_string(&input_msg).unwrap();
    assert_eq!(json, r#"{"type":"input","session_id":"123","data":"ls"}"#);

    // 4. Resize
    let resize_msg = ClientMessage::Resize {
        session_id: "123".to_string(),
        cols: 100,
        rows: 30,
    };
    let json = serde_json::to_string(&resize_msg).unwrap();
    assert_eq!(
        json,
        r#"{"type":"resize","session_id":"123","cols":100,"rows":30}"#
    );

    // 5. KillSession
    let kill_msg = ClientMessage::KillSession {
        session_id: "123".to_string(),
    };
    let json = serde_json::to_string(&kill_msg).unwrap();
    assert_eq!(json, r#"{"type":"kill_session","session_id":"123"}"#);

    // 6. RenameSession
    let rename_msg = ClientMessage::RenameSession {
        session_id: "123".to_string(),
        new_name: "prod".to_string(),
    };
    let json = serde_json::to_string(&rename_msg).unwrap();
    assert_eq!(
        json,
        r#"{"type":"rename_session","session_id":"123","new_name":"prod"}"#
    );
}

#[test]
fn test_server_message_serialization() {
    // 1. SessionList
    let session = SessionInfo {
        id: "123".to_string(),
        name: "default".to_string(),
        shell: "bash".to_string(),
        cwd: "/home/user".to_string(),
        started_at: "now".to_string(),
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
    let list_msg = ServerMessage::SessionList {
        sessions: vec![session],
    };
    let json = serde_json::to_string(&list_msg).unwrap();
    assert!(json.contains(r#"{"type":"SessionList""#));
    assert!(json.contains(r#""id":"123""#));

    // 2. Output
    let output_msg = ServerMessage::Output {
        session_id: "123".to_string(),
        data: "hi".to_string(),
    };
    let json = serde_json::to_string(&output_msg).unwrap();
    assert_eq!(json, r#"{"type":"Output","session_id":"123","data":"hi"}"#);

    // 3. SessionClosed
    let closed_msg = ServerMessage::SessionClosed {
        session_id: "123".to_string(),
    };
    let json = serde_json::to_string(&closed_msg).unwrap();
    assert_eq!(json, r#"{"type":"SessionClosed","session_id":"123"}"#);

    // 4. Error
    let error_msg = ServerMessage::Error {
        message: "bad".to_string(),
        error_code: None,
    };
    let json = serde_json::to_string(&error_msg).unwrap();
    assert_eq!(json, r#"{"type":"Error","message":"bad"}"#);
}
