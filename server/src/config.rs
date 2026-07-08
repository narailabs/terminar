//! Command-line interface configuration for the terminar server.
//!
//! Uses `clap` derive macros for argument parsing. The `Cli` struct defines
//! all supported flags, options, and subcommands.

use clap::Parser;

/// Command-line arguments for the terminar server.
///
/// Parse with `Cli::load()` or `Cli::try_parse_from(args)` for testing.
#[derive(Parser, Debug, Clone)]
#[command(author, version, about, long_about = None)]
pub struct Cli {
    /// Path to the Unix Domain Socket
    #[arg(short, long)]
    pub socket: Option<String>,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,

    /// Use a mock PTY backend for testing
    #[arg(long, default_value_t = false)]
    pub mock_pty: bool,

    /// Output logs in structured JSON format
    #[arg(long, default_value_t = false)]
    pub log_json: bool,

    /// Write logs to a file (in addition to console)
    #[arg(long)]
    pub log_file: Option<String>,

    /// Audit log verbosity level: off, auth, standard, verbose
    #[arg(long, default_value = "off")]
    pub audit_level: String,
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
        assert_eq!(cli.log_level, "info");
        assert!(!cli.mock_pty);
    }

    #[test]
    fn test_socket_path() {
        let args = vec!["server", "--socket", "/tmp/mysock"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.socket, Some("/tmp/mysock".to_string()));
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
    fn test_audit_level_default_off() {
        let args = vec!["server"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.audit_level, "off");
    }

    #[test]
    fn test_audit_level_custom() {
        let args = vec!["server", "--audit-level", "verbose"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.audit_level, "verbose");
    }
}
