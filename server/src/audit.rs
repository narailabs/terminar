//! Audit logging for security-relevant server events.
//!
//! Provides structured audit events with configurable verbosity levels.
//! Events are categorized into three levels:
//! - **Auth**: Authentication successes/failures, rate limiting, token revocation
//! - **Standard**: Session lifecycle, pairing, configuration changes
//! - **Verbose**: Connection open/close, reconnection attempts, token refreshes

use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

/// Verbosity level for audit logging.
///
/// Controls which events are recorded. Each level includes all events
/// from less verbose levels (Auth < Standard < Verbose).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditLevel {
    Off,
    Auth,
    Standard,
    Verbose,
}

impl AuditLevel {
    /// Returns true if an event at `event_level` should be logged
    /// when the logger is configured at `self` level.
    pub fn should_log(&self, event_level: &AuditLevel) -> bool {
        match self {
            AuditLevel::Off => false,
            _ => event_level.rank() <= self.rank(),
        }
    }

    fn rank(&self) -> u8 {
        match self {
            AuditLevel::Off => 0,
            AuditLevel::Auth => 1,
            AuditLevel::Standard => 2,
            AuditLevel::Verbose => 3,
        }
    }

    /// Parse an audit level from a string. Defaults to `Standard` for unknown values.
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "off" => AuditLevel::Off,
            "auth" => AuditLevel::Auth,
            "standard" => AuditLevel::Standard,
            "verbose" => AuditLevel::Verbose,
            _ => AuditLevel::Standard,
        }
    }
}

/// Types of auditable events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventType {
    AuthSuccess,
    AuthFailure,
    AuthRateLimited,
    TokenRevoked,
    SessionCreated,
    SessionAttached,
    SessionDetached,
    SessionClosed,
    PairingCodeGenerated,
    PairingCodeUsed,
    ServerConfigChanged,
    ConnectionOpened,
    ConnectionClosed,
    ReconnectionAttempt,
    TokenRefreshed,
}

impl AuditEventType {
    /// Returns the audit level for this event type.
    pub fn level(&self) -> AuditLevel {
        match self {
            Self::AuthSuccess
            | Self::AuthFailure
            | Self::AuthRateLimited
            | Self::TokenRevoked => AuditLevel::Auth,

            Self::SessionCreated
            | Self::SessionAttached
            | Self::SessionDetached
            | Self::SessionClosed
            | Self::PairingCodeGenerated
            | Self::PairingCodeUsed
            | Self::ServerConfigChanged => AuditLevel::Standard,

            Self::ConnectionOpened
            | Self::ConnectionClosed
            | Self::ReconnectionAttempt
            | Self::TokenRefreshed => AuditLevel::Verbose,
        }
    }
}

/// A structured audit event ready for serialization.
#[derive(Debug, Clone, Serialize)]
pub struct AuditEvent {
    pub timestamp: String,
    pub event: AuditEventType,
    pub level: AuditLevel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub details: serde_json::Value,
}

impl Default for AuditEvent {
    fn default() -> Self {
        Self {
            timestamp: String::new(),
            event: AuditEventType::ConnectionOpened,
            level: AuditLevel::Verbose,
            username: None,
            method: None,
            client_ip: None,
            connection_type: None,
            session_id: None,
            client_id: None,
            reason: None,
            details: serde_json::Value::Null,
        }
    }
}

/// Async audit logger that writes JSON-lines to a file via a background task.
///
/// Events are sent through an mpsc channel and written by a background tokio task
/// using a buffered writer. The logger filters events based on the configured level.
pub struct AuditLogger {
    sender: mpsc::UnboundedSender<AuditEvent>,
    flush_tx: mpsc::Sender<tokio::sync::oneshot::Sender<()>>,
}

impl AuditLogger {
    /// Create a new AuditLogger that writes to the given file path.
    ///
    /// Events below the configured `level` are silently dropped.
    /// The file is opened in append mode and created if it doesn't exist.
    pub async fn new(path: PathBuf, level: AuditLevel) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;

        let (sender, mut receiver) = mpsc::unbounded_channel::<AuditEvent>();
        let (flush_tx, mut flush_rx) = mpsc::channel::<tokio::sync::oneshot::Sender<()>>(1);

        tokio::spawn(async move {
            let mut writer = tokio::io::BufWriter::new(file);
            loop {
                tokio::select! {
                    biased; // Process events before flushes

                    msg = receiver.recv() => {
                        match msg {
                            Some(event) => {
                                if level.should_log(&event.event.level()) {
                                    if let Ok(json) = serde_json::to_string(&event) {
                                        let _ = writer.write_all(json.as_bytes()).await;
                                        let _ = writer.write_all(b"\n").await;
                                    }
                                }
                            }
                            None => break, // Channel closed
                        }
                    }
                    msg = flush_rx.recv() => {
                        match msg {
                            Some(done) => {
                                // Drain any pending events before flushing
                                while let Ok(event) = receiver.try_recv() {
                                    if level.should_log(&event.event.level()) {
                                        if let Ok(json) = serde_json::to_string(&event) {
                                            let _ = writer.write_all(json.as_bytes()).await;
                                            let _ = writer.write_all(b"\n").await;
                                        }
                                    }
                                }
                                let _ = writer.flush().await;
                                let _ = done.send(());
                            }
                            None => break, // Flush channel closed
                        }
                    }
                }
            }
            // Flush any remaining data before exiting
            let _ = writer.flush().await;
        });

        Ok(Self { sender, flush_tx })
    }

    /// Log an audit event. This is non-blocking; the event is sent to the
    /// background writer task via an unbounded channel.
    pub fn log(&self, event: AuditEvent) {
        let _ = self.sender.send(event);
    }

    /// Flush all buffered events to disk. Returns when the flush is complete.
    pub async fn flush(&self) {
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let _ = self.flush_tx.send(done_tx).await;
        let _ = done_rx.await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audit_event_serializes_to_json() {
        let event = AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::AuthSuccess,
            level: AuditLevel::Auth,
            username: Some("narayan".to_string()),
            method: Some("ssh_pubkey".to_string()),
            client_ip: Some("192.168.1.50".to_string()),
            connection_type: Some("websocket".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("auth_success"));
        assert!(json.contains("narayan"));
        assert!(json.contains("ssh_pubkey"));
        assert!(json.contains("192.168.1.50"));
    }

    #[test]
    fn test_audit_event_skips_none_fields() {
        let event = AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::AuthFailure,
            level: AuditLevel::Auth,
            ..Default::default()
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(!json.contains("username"));
        assert!(!json.contains("session_id"));
        assert!(!json.contains("details"));
    }

    #[test]
    fn test_audit_level_filtering_auth() {
        // Auth level should log Auth events but not Standard or Verbose
        assert!(AuditLevel::Auth.should_log(&AuditLevel::Auth));
        assert!(!AuditLevel::Auth.should_log(&AuditLevel::Standard));
        assert!(!AuditLevel::Auth.should_log(&AuditLevel::Verbose));
    }

    #[test]
    fn test_audit_level_filtering_standard() {
        // Standard level should log Auth and Standard, but not Verbose
        assert!(AuditLevel::Standard.should_log(&AuditLevel::Auth));
        assert!(AuditLevel::Standard.should_log(&AuditLevel::Standard));
        assert!(!AuditLevel::Standard.should_log(&AuditLevel::Verbose));
    }

    #[test]
    fn test_audit_level_filtering_verbose() {
        // Verbose level should log everything
        assert!(AuditLevel::Verbose.should_log(&AuditLevel::Auth));
        assert!(AuditLevel::Verbose.should_log(&AuditLevel::Standard));
        assert!(AuditLevel::Verbose.should_log(&AuditLevel::Verbose));
    }

    #[test]
    fn test_audit_level_filtering_off() {
        // Off level should log nothing
        assert!(!AuditLevel::Off.should_log(&AuditLevel::Auth));
        assert!(!AuditLevel::Off.should_log(&AuditLevel::Standard));
        assert!(!AuditLevel::Off.should_log(&AuditLevel::Verbose));
    }

    #[test]
    fn test_event_type_levels() {
        assert_eq!(AuditEventType::AuthSuccess.level(), AuditLevel::Auth);
        assert_eq!(AuditEventType::AuthFailure.level(), AuditLevel::Auth);
        assert_eq!(AuditEventType::AuthRateLimited.level(), AuditLevel::Auth);
        assert_eq!(AuditEventType::TokenRevoked.level(), AuditLevel::Auth);

        assert_eq!(AuditEventType::SessionCreated.level(), AuditLevel::Standard);
        assert_eq!(AuditEventType::SessionClosed.level(), AuditLevel::Standard);
        assert_eq!(AuditEventType::PairingCodeGenerated.level(), AuditLevel::Standard);

        assert_eq!(AuditEventType::ConnectionOpened.level(), AuditLevel::Verbose);
        assert_eq!(AuditEventType::TokenRefreshed.level(), AuditLevel::Verbose);
    }

    #[test]
    fn test_audit_level_from_str() {
        assert_eq!(AuditLevel::from_str("off"), AuditLevel::Off);
        assert_eq!(AuditLevel::from_str("auth"), AuditLevel::Auth);
        assert_eq!(AuditLevel::from_str("standard"), AuditLevel::Standard);
        assert_eq!(AuditLevel::from_str("verbose"), AuditLevel::Verbose);
        assert_eq!(AuditLevel::from_str("VERBOSE"), AuditLevel::Verbose);
        assert_eq!(AuditLevel::from_str("unknown"), AuditLevel::Standard);
    }

    #[test]
    fn test_audit_level_serialization() {
        let level = AuditLevel::Auth;
        let json = serde_json::to_string(&level).unwrap();
        assert_eq!(json, "\"auth\"");

        let deserialized: AuditLevel = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, AuditLevel::Auth);
    }

    #[tokio::test]
    async fn test_audit_logger_writes_to_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let log_path = tmp.path().join("audit.log");
        let logger = AuditLogger::new(log_path.clone(), AuditLevel::Verbose).await.unwrap();

        logger.log(AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::AuthSuccess,
            level: AuditLevel::Auth,
            username: Some("test".to_string()),
            ..Default::default()
        });

        logger.flush().await;

        let contents = std::fs::read_to_string(&log_path).unwrap();
        assert!(contents.contains("auth_success"));
        assert!(contents.contains("test"));
    }

    #[tokio::test]
    async fn test_audit_logger_respects_level_filter() {
        let tmp = tempfile::TempDir::new().unwrap();
        let log_path = tmp.path().join("audit.log");
        let logger = AuditLogger::new(log_path.clone(), AuditLevel::Auth).await.unwrap();

        // This is a "verbose" level event -- should NOT be logged at "auth" level
        logger.log(AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::ConnectionOpened,
            level: AuditLevel::Verbose,
            ..Default::default()
        });

        logger.flush().await;

        let contents = std::fs::read_to_string(&log_path).unwrap_or_default();
        assert!(!contents.contains("connection_opened"));
    }

    #[tokio::test]
    async fn test_audit_logger_writes_multiple_events() {
        let tmp = tempfile::TempDir::new().unwrap();
        let log_path = tmp.path().join("audit.log");
        let logger = AuditLogger::new(log_path.clone(), AuditLevel::Verbose).await.unwrap();

        logger.log(AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::AuthSuccess,
            level: AuditLevel::Auth,
            username: Some("alice".to_string()),
            ..Default::default()
        });

        logger.log(AuditEvent {
            timestamp: "2026-02-16T10:31:00Z".to_string(),
            event: AuditEventType::SessionCreated,
            level: AuditLevel::Standard,
            session_id: Some("sess-123".to_string()),
            ..Default::default()
        });

        logger.flush().await;

        let contents = std::fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("auth_success"));
        assert!(lines[1].contains("session_created"));
    }

    #[tokio::test]
    async fn test_audit_logger_auth_level_logs_auth_but_not_standard() {
        let tmp = tempfile::TempDir::new().unwrap();
        let log_path = tmp.path().join("audit.log");
        let logger = AuditLogger::new(log_path.clone(), AuditLevel::Auth).await.unwrap();

        // Auth event -- should be logged
        logger.log(AuditEvent {
            timestamp: "2026-02-16T10:30:00Z".to_string(),
            event: AuditEventType::AuthFailure,
            level: AuditLevel::Auth,
            ..Default::default()
        });

        // Standard event -- should NOT be logged
        logger.log(AuditEvent {
            timestamp: "2026-02-16T10:31:00Z".to_string(),
            event: AuditEventType::SessionCreated,
            level: AuditLevel::Standard,
            ..Default::default()
        });

        logger.flush().await;

        let contents = std::fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains("auth_failure"));
    }
}
