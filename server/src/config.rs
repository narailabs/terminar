//! Command-line interface configuration for the terminar server.
//!
//! Uses `clap` derive macros for argument parsing. The `Cli` struct defines
//! all supported flags and options.

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

    /// Communicate via stdin/stdout
    #[arg(long, default_value_t = false)]
    pub stdio: bool,

    /// Default shell to use
    #[arg(long)]
    pub shell: Option<String>,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    pub log_level: String,

    /// Disable authentication (kept for compilation compatibility)
    #[arg(long, default_value_t = false)]
    pub no_auth: bool,

    /// Use a mock PTY backend for testing
    #[arg(long, default_value_t = false)]
    pub mock_pty: bool,
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
        assert!(!cli.no_auth);
        assert!(!cli.mock_pty);
        assert!(!cli.stdio);
        assert!(cli.socket.is_none());
        assert!(cli.shell.is_none());
    }

    #[test]
    fn test_socket_path() {
        let args = vec!["server", "--socket", "/tmp/mysock"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.socket, Some("/tmp/mysock".to_string()));
    }

    #[test]
    fn test_no_auth_flag() {
        let args = vec!["server", "--no-auth"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.no_auth);
    }

    #[test]
    fn test_mock_pty_flag() {
        let args = vec!["server", "--mock-pty"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.mock_pty);
    }

    #[test]
    fn test_stdio_flag() {
        let args = vec!["server", "--stdio"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert!(cli.stdio);
    }

    #[test]
    fn test_shell_option() {
        let args = vec!["server", "--shell", "/bin/zsh"];
        let cli = Cli::try_parse_from(args).unwrap();
        assert_eq!(cli.shell, Some("/bin/zsh".to_string()));
    }
}
