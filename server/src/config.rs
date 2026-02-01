//! Command-line interface configuration for the termiNar server.
//!
//! Uses `clap` derive macros for argument parsing. The `Cli` struct defines
//! all supported flags, options, and subcommands.

use clap::{Parser, Subcommand};

/// Command-line arguments for the termiNar server.
///
/// Parse with `Cli::load()` or `Cli::try_parse_from(args)` for testing.
#[derive(Parser, Debug, Clone)]
#[command(author, version, about, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,

    /// Port to listen on for WebSocket connections
    #[arg(short, long, default_value_t = 3000)]
    pub port: u16,

    /// Path to the Unix Domain Socket
    #[arg(short, long)]
    pub socket: Option<String>,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,

    /// Disable authentication (DANGEROUS: Development only)
    #[arg(long, default_value_t = false)]
    pub no_auth: bool,

    /// Use a mock PTY backend for testing
    #[arg(long, default_value_t = false)]
    pub mock_pty: bool,

    /// Allowed CORS origins (can be specified multiple times)
    /// Defaults to localhost on common dev ports if not specified
    #[arg(long = "cors-origin", value_name = "ORIGIN")]
    pub cors_origins: Vec<String>,

    /// Output logs in structured JSON format
    #[arg(long, default_value_t = false)]
    pub log_json: bool,

    /// Write logs to a file (in addition to console)
    #[arg(long)]
    pub log_file: Option<String>,

    /// Persist session metadata to disk for recovery on restart
    #[arg(long, default_value_t = false)]
    pub persist_sessions: bool,

    /// Path to session persistence file (default: /tmp/terminar-sessions.json)
    #[arg(long)]
    pub session_file: Option<String>,

    /// Enable zstd compression for history buffers exceeding 1MB
    #[arg(long, default_value_t = false)]
    pub compress_history: bool,

    /// Persist terminal history to disk on session close and load on resume
    #[arg(long, default_value_t = false)]
    pub persist_history: bool,

    /// Directory for history persistence files (default: /tmp/terminar-history)
    #[arg(long)]
    pub history_dir: Option<String>,

    /// Path to TLS certificate file (PEM format). Enables TLS when provided with --tls-key.
    #[arg(long)]
    pub tls_cert: Option<String>,

    /// Path to TLS private key file (PEM format). Required when --tls-cert is provided.
    #[arg(long)]
    pub tls_key: Option<String>,

    /// Port for the TLS/HTTPS listener (default: 8444)
    #[arg(long, default_value_t = 8444)]
    pub tls_port: u16,

    /// Maximum failed auth attempts per IP before hard lockout (default: 5)
    #[arg(long, default_value_t = 5)]
    pub max_auth_attempts: usize,
}

/// Available CLI subcommands.
#[derive(Subcommand, Debug, Clone)]
pub enum Commands {
    /// Generate a pairing code for remote client authentication.
    ///
    /// Connects to the running server via Unix socket and requests
    /// an 8-digit pairing code that can be exchanged for an API token.
    Pair,
}

impl Cli {

    pub fn load() -> Self {

        Cli::parse()

    }

}



#[cfg(test)]
mod tests {

    use super::*;



    #[test]

    fn test_default_config() {

        let args = vec!["server"];

        let cli = Cli::try_parse_from(args).unwrap();

        assert_eq!(cli.port, 3000);

        assert_eq!(cli.log_level, "info");

        assert!(!cli.no_auth);

        assert!(cli.command.is_none());

    }



    #[test]

    fn test_custom_port_and_auth() {

        let args = vec!["server", "--port", "8080", "--no-auth"];

        let cli = Cli::try_parse_from(args).unwrap();

        assert_eq!(cli.port, 8080);

        assert!(cli.no_auth);

    }



    #[test]

    fn test_socket_path() {

        let args = vec!["server", "--socket", "/tmp/mysock"];

        let cli = Cli::try_parse_from(args).unwrap();

        assert_eq!(cli.socket, Some("/tmp/mysock".to_string()));

    }



    #[test]

    fn test_pair_command() {

        let args = vec!["server", "pair"];

        let cli = Cli::try_parse_from(args).unwrap();

        match cli.command {

            Some(Commands::Pair) => {},

            _ => panic!("Expected Pair command"),

        }

    }

    #[test]
    fn test_log_json_default_false() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(!cli.log_json);
    }

    #[test]
    fn test_log_json_flag() {
        let args = vec!["server", "--log-json"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.log_json);
    }

    #[test]
    fn test_log_file_default_none() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.log_file.is_none());
    }

    #[test]
    fn test_log_file_flag() {
        let args = vec!["server", "--log-file", "/tmp/server.log"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.log_file, Some("/tmp/server.log".to_string()));
    }

    #[test]
    fn test_persist_sessions_default_false() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(!cli.persist_sessions);
    }

    #[test]
    fn test_persist_sessions_flag() {
        let args = vec!["server", "--persist-sessions"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.persist_sessions);
    }

    #[test]
    fn test_session_file_default_none() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.session_file.is_none());
    }

    #[test]
    fn test_session_file_flag() {
        let args = vec!["server", "--session-file", "/tmp/my-sessions.json"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.session_file, Some("/tmp/my-sessions.json".to_string()));
    }

    #[test]
    fn test_compress_history_default_false() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(!cli.compress_history);
    }

    #[test]
    fn test_compress_history_flag() {
        let args = vec!["server", "--compress-history"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.compress_history);
    }

    #[test]
    fn test_persist_history_default_false() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(!cli.persist_history);
    }

    #[test]
    fn test_persist_history_flag() {
        let args = vec!["server", "--persist-history"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.persist_history);
    }

    #[test]
    fn test_history_dir_default_none() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.history_dir.is_none());
    }

    #[test]
    fn test_history_dir_flag() {
        let args = vec!["server", "--history-dir", "/tmp/my-history"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.history_dir, Some("/tmp/my-history".to_string()));
    }

    // TLS configuration tests

    #[test]
    fn test_tls_defaults_none() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.tls_cert.is_none());
        assert!(cli.tls_key.is_none());
        assert_eq!(cli.tls_port, 8444);
    }

    #[test]
    fn test_tls_cert_and_key_flags() {
        let args = vec![
            "server",
            "--tls-cert", "/path/to/cert.pem",
            "--tls-key", "/path/to/key.pem",
        ];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.tls_cert, Some("/path/to/cert.pem".to_string()));
        assert_eq!(cli.tls_key, Some("/path/to/key.pem".to_string()));
    }

    #[test]
    fn test_tls_port_custom() {
        let args = vec![
            "server",
            "--tls-cert", "/path/to/cert.pem",
            "--tls-key", "/path/to/key.pem",
            "--tls-port", "9443",
        ];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.tls_port, 9443);
    }

    #[test]
    fn test_tls_cert_without_key_parses() {
        // Parsing should succeed - validation is separate
        let args = vec!["server", "--tls-cert", "/path/to/cert.pem"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.tls_cert.is_some());
        assert!(cli.tls_key.is_none());
    }

    #[test]
    fn test_max_auth_attempts_default() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.max_auth_attempts, 5);
    }

    #[test]
    fn test_max_auth_attempts_custom() {
        let args = vec!["server", "--max-auth-attempts", "10"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.max_auth_attempts, 10);
    }

    #[test]
    fn test_tls_key_without_cert_parses() {
        // Parsing should succeed - validation is separate
        let args = vec!["server", "--tls-key", "/path/to/key.pem"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.tls_cert.is_none());
        assert!(cli.tls_key.is_some());
    }
}
