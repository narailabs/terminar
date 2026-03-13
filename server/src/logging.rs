use crate::config::Cli;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, fmt};

/// Initialize the tracing subscriber based on CLI configuration.
///
/// Supports configurable log level (`--log-level`).
///
/// Returns None (no file logging guard needed).
pub fn init_logging(cli: &Cli) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let env_filter = EnvFilter::try_new(&cli.log_level).unwrap_or_else(|_| EnvFilter::new("info"));

    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer());
    let _ = tracing::subscriber::set_global_default(subscriber);
    None
}

/// Generate a new request ID (UUID v4) for request tracing.
pub fn new_request_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    fn cli_from(args: &[&str]) -> Cli {
        let mut full_args = vec!["server"];
        full_args.extend_from_slice(args);
        Cli::try_parse_from(full_args).unwrap()
    }

    #[test]
    fn test_new_request_id_returns_valid_uuid() {
        let id = new_request_id();
        assert_eq!(id.len(), 36, "UUID should be 36 chars");
        assert_eq!(
            id.chars().filter(|c| *c == '-').count(),
            4,
            "UUID should have 4 dashes"
        );
    }

    #[test]
    fn test_new_request_id_is_unique() {
        let id1 = new_request_id();
        let id2 = new_request_id();
        assert_ne!(id1, id2, "Each request ID should be unique");
    }

    #[test]
    fn test_init_logging_default_returns_no_guard() {
        let cli = cli_from(&[]);
        let guard = init_logging(&cli);
        assert!(guard.is_none(), "No file logging means no guard needed");
    }
}
