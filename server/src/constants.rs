//! Centralized constants for the termiNar server.
//!
//! All magic numbers, configuration defaults, and security constants
//! are defined here to ensure consistency and discoverability.

use std::time::Duration;

// ==================== Protocol Constants ====================

/// Protocol version for client-server version negotiation.
pub const PROTOCOL_VERSION: &str = "0.2.0";

// ==================== Security Constants ====================

/// Whitelist of approved shell paths for security.
/// Only these shells can be spawned via CreateSession.
/// Includes common locations on Linux and macOS (including Homebrew paths).
pub const SHELL_WHITELIST: &[&str] = &[
    "/bin/bash",
    "/bin/sh",
    "/bin/zsh",
    "/usr/bin/fish",
    "/usr/local/bin/bash",
    "/usr/local/bin/zsh",
    "/usr/local/bin/fish",
    "/opt/homebrew/bin/bash",
    "/opt/homebrew/bin/zsh",
    "/opt/homebrew/bin/fish",
];

/// Blocklist of environment variables that could be used for code injection.
/// These variables are filtered out before spawning shells to prevent
/// library injection attacks (e.g., LD_PRELOAD, DYLD_INSERT_LIBRARIES).
pub const ENV_BLOCKLIST: &[&str] = &[
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_FORCE_FLAT_NAMESPACE",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
];

// ==================== Rate Limiting Constants ====================

/// Maximum number of pairing attempts allowed per IP address
/// within the rate limit window before hard lockout.
pub const RATE_LIMIT_MAX_ATTEMPTS: usize = 5;

/// Duration of the rate limit window in seconds (15 minutes).
/// After this period, old attempts are purged.
pub const RATE_LIMIT_WINDOW_SECS: u64 = 15 * 60;

/// Maximum number of failed authentication attempts per WebSocket connection
/// before the connection is closed with RATE_LIMIT_EXCEEDED.
pub const MAX_WS_AUTH_ATTEMPTS: usize = 5;

/// Access token lifetime: 15 minutes.
/// Short-lived tokens minimize exposure if compromised.
pub const ACCESS_TOKEN_EXPIRY_SECS: u64 = 15 * 60;

/// Refresh token lifetime: 7 days.
/// Used to obtain new access tokens without re-authenticating.
pub const REFRESH_TOKEN_EXPIRY_SECS: u64 = 7 * 24 * 60 * 60;

// ==================== PTY Constants ====================

/// Buffer size for PTY read operations (16KB).
/// Larger buffer reduces syscall overhead for high-throughput terminal output.
pub const PTY_READ_BUFFER_SIZE: usize = 16384;

// ==================== History Constants ====================

/// Default history buffer capacity (10 MB).
/// This is sufficient for most terminal sessions while bounding memory usage.
pub const DEFAULT_HISTORY_CAPACITY: usize = 10 * 1024 * 1024;

/// Threshold in bytes above which history data should be compressed.
/// When the buffer exceeds this size, zstd compression is applied
/// during replay/persistence.
pub const COMPRESSION_THRESHOLD: usize = 1024 * 1024; // 1 MB

/// Subdirectory name under ~/.terminar/ for session history files.
pub const HISTORY_SUBDIR: &str = "sessions";

/// Filename for session metadata persistence (under ~/.terminar/).
pub const SESSION_METADATA_FILE: &str = "sessions.json";

/// Interval in seconds between periodic saves of session history and metadata.
pub const PERIODIC_SAVE_INTERVAL_SECS: u64 = 60;

// ==================== Network Constants ====================

/// Default CORS origins for development.
/// These cover common localhost dev server ports.
pub const DEFAULT_CORS_ORIGINS: &[&str] = &[
    "http://localhost:6749",
    "http://localhost:3001",  // Vite dev server
    "http://localhost:5173",  // Vite default
    "http://localhost:8080",
    "http://127.0.0.1:6749",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
];

/// Interval between WebSocket ping messages.
pub const PING_INTERVAL: Duration = Duration::from_secs(30);

/// Timeout for pong response before considering connection stale.
pub const PONG_TIMEOUT: Duration = Duration::from_secs(60);

// ==================== Server Constants ====================

/// Graceful shutdown timeout in seconds.
/// The server will wait this long for in-flight requests to complete
/// before forcing cleanup.
pub const SHUTDOWN_TIMEOUT_SECS: u64 = 5;
