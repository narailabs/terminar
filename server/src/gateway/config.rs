//! CLI configuration for the terminar gateway.
//!
//! The gateway is a multi-user reverse proxy that authenticates clients
//! and routes WebSocket connections to per-user terminar-server instances.

use clap::Parser;

/// Command-line arguments for the terminar gateway.
#[derive(Parser, Debug, Clone)]
#[command(
    name = "terminar-gateway",
    version,
    about = "Multi-user gateway for terminar"
)]
pub struct GatewayConfig {
    /// Port to listen on for HTTP/WebSocket connections
    #[arg(short, long, default_value_t = 6749)]
    pub port: u16,

    /// Path to TLS certificate file (PEM format)
    #[arg(long)]
    pub tls_cert: Option<String>,

    /// Path to TLS private key file (PEM format)
    #[arg(long)]
    pub tls_key: Option<String>,

    /// Disable auto-generation of a self-signed TLS certificate on startup.
    /// By default, auto-TLS is enabled. When --tls-cert and --tls-key are
    /// provided, the supplied certificate takes precedence regardless of
    /// this flag. Pass --no-auto-tls to disable automatic certificate generation.
    #[arg(long = "no-auto-tls", default_value_t = true, action = clap::ArgAction::SetFalse)]
    pub auto_tls: bool,

    /// Port for the TLS/HTTPS listener
    #[arg(long, default_value_t = 8444)]
    pub tls_port: u16,

    /// Path to the terminar-server binary
    #[arg(long, default_value = "terminar-server")]
    pub server_bin: String,

    /// Directory for per-user server Unix sockets
    #[arg(long, default_value = "/run/terminar")]
    pub socket_dir: String,

    /// Idle timeout (seconds) before shutting down a per-user server
    #[arg(long, default_value_t = 1800)]
    pub idle_timeout: u64,

    /// Maximum failed auth attempts per connection
    #[arg(long, default_value_t = 5)]
    pub max_auth_attempts: usize,

    /// Audit log level: off, auth, standard, verbose
    #[arg(long, default_value = "standard")]
    pub audit_level: String,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_default_config() {
        let args = vec!["terminar-gateway"];
        let config = GatewayConfig::try_parse_from(args).unwrap();
        assert_eq!(config.port, 6749);
        assert_eq!(config.tls_port, 8444);
        assert!(config.auto_tls);
        assert_eq!(config.server_bin, "terminar-server");
        assert_eq!(config.socket_dir, "/run/terminar");
        assert_eq!(config.idle_timeout, 1800);
        assert_eq!(config.max_auth_attempts, 5);
        assert_eq!(config.audit_level, "standard");
    }

    #[test]
    fn test_gateway_custom_config() {
        let args = vec![
            "terminar-gateway",
            "--port",
            "8080",
            "--server-bin",
            "/usr/local/bin/terminar-server",
            "--socket-dir",
            "/tmp/terminar",
            "--idle-timeout",
            "3600",
            "--max-auth-attempts",
            "10",
            "--audit-level",
            "verbose",
        ];
        let config = GatewayConfig::try_parse_from(args).unwrap();
        assert_eq!(config.port, 8080);
        assert_eq!(config.server_bin, "/usr/local/bin/terminar-server");
        assert_eq!(config.socket_dir, "/tmp/terminar");
        assert_eq!(config.idle_timeout, 3600);
        assert_eq!(config.max_auth_attempts, 10);
        assert_eq!(config.audit_level, "verbose");
    }

    #[test]
    fn test_gateway_tls_config() {
        let args = vec![
            "terminar-gateway",
            "--tls-cert",
            "/path/to/cert.pem",
            "--tls-key",
            "/path/to/key.pem",
            "--tls-port",
            "9443",
        ];
        let config = GatewayConfig::try_parse_from(args).unwrap();
        assert_eq!(config.tls_cert, Some("/path/to/cert.pem".to_string()));
        assert_eq!(config.tls_key, Some("/path/to/key.pem".to_string()));
        assert_eq!(config.tls_port, 9443);
    }

    #[test]
    fn test_no_auto_tls_flag() {
        let args = vec!["terminar-gateway", "--no-auto-tls"];
        let config = GatewayConfig::try_parse_from(args).unwrap();
        assert!(!config.auto_tls);
    }
}
