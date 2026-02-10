//! Error types for the termiNar server.
//!
//! Uses `thiserror` for structured, ergonomic error handling.

use thiserror::Error;

/// Errors that can occur in server operations.
#[derive(Error, Debug)]
pub enum ServerError {
    /// Session with the given ID was not found.
    #[error("session not found: {0}")]
    SessionNotFound(String),

    /// Authentication failed (invalid or expired token).
    #[error("authentication failed")]
    AuthFailed,

    /// PTY-related error.
    #[error("PTY error: {0}")]
    PtyError(String),

    /// WebSocket communication error.
    #[error("WebSocket error: {0}")]
    WebSocketError(String),

    /// Message serialization/deserialization error.
    #[error("protocol error: {0}")]
    ProtocolError(String),

    /// Rate limit exceeded.
    #[error("rate limit exceeded")]
    RateLimitExceeded,

    /// Invalid input provided.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Internal server error.
    #[error("internal error: {0}")]
    Internal(String),
}

impl ServerError {
    /// Creates a new SessionNotFound error.
    pub fn session_not_found(id: impl Into<String>) -> Self {
        ServerError::SessionNotFound(id.into())
    }

    /// Creates a new PtyError.
    pub fn pty(msg: impl Into<String>) -> Self {
        ServerError::PtyError(msg.into())
    }

    /// Creates a new ProtocolError.
    pub fn protocol(msg: impl Into<String>) -> Self {
        ServerError::ProtocolError(msg.into())
    }

    /// Creates a new InvalidInput error.
    pub fn invalid_input(msg: impl Into<String>) -> Self {
        ServerError::InvalidInput(msg.into())
    }

    /// Returns a machine-readable error code string for this error variant.
    pub fn error_code(&self) -> &'static str {
        match self {
            ServerError::SessionNotFound(_) => "SESSION_NOT_FOUND",
            ServerError::AuthFailed => "AUTH_FAILED",
            ServerError::PtyError(_) => "PTY_ERROR",
            ServerError::WebSocketError(_) => "WEBSOCKET_ERROR",
            ServerError::ProtocolError(_) => "PROTOCOL_ERROR",
            ServerError::RateLimitExceeded => "RATE_LIMIT_EXCEEDED",
            ServerError::InvalidInput(_) => "INVALID_INPUT",
            ServerError::Internal(_) => "INTERNAL_ERROR",
        }
    }

    /// Converts this error into a `ServerMessage::Error` with both human-readable message and machine-readable error code.
    pub fn to_error_message(&self) -> crate::messages::ServerMessage {
        crate::messages::ServerMessage::Error {
            message: self.to_string(),
            error_code: Some(self.error_code().to_string()),
        }
    }
}

impl From<serde_json::Error> for ServerError {
    fn from(err: serde_json::Error) -> Self {
        ServerError::ProtocolError(err.to_string())
    }
}

impl From<std::io::Error> for ServerError {
    fn from(err: std::io::Error) -> Self {
        ServerError::Internal(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_not_found_error() {
        let err = ServerError::session_not_found("test-id");
        assert_eq!(err.to_string(), "session not found: test-id");
    }

    #[test]
    fn test_auth_failed_error() {
        let err = ServerError::AuthFailed;
        assert_eq!(err.to_string(), "authentication failed");
    }

    #[test]
    fn test_pty_error() {
        let err = ServerError::pty("spawn failed");
        assert_eq!(err.to_string(), "PTY error: spawn failed");
    }

    #[test]
    fn test_protocol_error() {
        let err = ServerError::protocol("invalid JSON");
        assert_eq!(err.to_string(), "protocol error: invalid JSON");
    }

    #[test]
    fn test_rate_limit_error() {
        let err = ServerError::RateLimitExceeded;
        assert_eq!(err.to_string(), "rate limit exceeded");
    }

    #[test]
    fn test_invalid_input_error() {
        let err = ServerError::invalid_input("cols must be > 0");
        assert_eq!(err.to_string(), "invalid input: cols must be > 0");
    }

    #[test]
    fn test_from_serde_error() {
        let json_err = serde_json::from_str::<String>("not valid json").unwrap_err();
        let err: ServerError = json_err.into();
        assert!(err.to_string().starts_with("protocol error:"));
    }

    #[test]
    fn test_error_codes() {
        assert_eq!(ServerError::session_not_found("x").error_code(), "SESSION_NOT_FOUND");
        assert_eq!(ServerError::AuthFailed.error_code(), "AUTH_FAILED");
        assert_eq!(ServerError::pty("x").error_code(), "PTY_ERROR");
        assert_eq!(ServerError::WebSocketError("x".into()).error_code(), "WEBSOCKET_ERROR");
        assert_eq!(ServerError::protocol("x").error_code(), "PROTOCOL_ERROR");
        assert_eq!(ServerError::RateLimitExceeded.error_code(), "RATE_LIMIT_EXCEEDED");
        assert_eq!(ServerError::invalid_input("x").error_code(), "INVALID_INPUT");
        assert_eq!(ServerError::Internal("x".into()).error_code(), "INTERNAL_ERROR");
    }

    #[test]
    fn test_to_error_message() {
        let err = ServerError::session_not_found("test-id");
        let msg = err.to_error_message();
        match msg {
            crate::messages::ServerMessage::Error { message, error_code } => {
                assert_eq!(message, "session not found: test-id");
                assert_eq!(error_code, Some("SESSION_NOT_FOUND".to_string()));
            }
            _ => panic!("Expected Error message"),
        }
    }
}
