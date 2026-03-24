use crate::config::Cli;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, fmt};

/// Initialize the tracing subscriber based on CLI configuration.
///
/// Supports:
/// - Standard text output (default) or structured JSON (`--log-json`)
/// - Console output (always on)
/// - File output (`--log-file <path>`) -- logs to both console and file simultaneously
/// - Configurable log level (`--log-level`)
///
/// Returns a guard that must be kept alive for the duration of the program
/// to ensure file logs are flushed.
pub fn init_logging(cli: &Cli) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let env_filter = EnvFilter::try_new(&cli.log_level).unwrap_or_else(|_| EnvFilter::new("info"));

    match (&cli.log_file, cli.log_json) {
        // No file, no JSON -- plain console
        (None, false) => {
            let subscriber = tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt::layer());
            let _ = tracing::subscriber::set_global_default(subscriber);
            None
        }
        // No file, JSON -- JSON console
        (None, true) => {
            let subscriber = tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt::layer().json());
            let _ = tracing::subscriber::set_global_default(subscriber);
            None
        }
        // File, no JSON -- plain console + plain file
        (Some(path), false) => {
            let (dir, filename) = split_log_path(path);
            let file_appender = tracing_appender::rolling::never(dir, filename);
            let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

            let subscriber = tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt::layer()) // console
                .with(fmt::layer().with_writer(non_blocking)); // file
            let _ = tracing::subscriber::set_global_default(subscriber);
            Some(guard)
        }
        // File, JSON -- JSON console + JSON file
        (Some(path), true) => {
            let (dir, filename) = split_log_path(path);
            let file_appender = tracing_appender::rolling::never(dir, filename);
            let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

            let subscriber = tracing_subscriber::registry()
                .with(env_filter)
                .with(fmt::layer().json()) // console
                .with(fmt::layer().json().with_writer(non_blocking)); // file
            let _ = tracing::subscriber::set_global_default(subscriber);
            Some(guard)
        }
    }
}

/// Split a log file path into directory and filename components.
fn split_log_path(path: &str) -> (String, String) {
    let p = std::path::Path::new(path);
    let dir = p
        .parent()
        .map(|d| d.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());
    let filename = p
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| "server.log".to_string());
    (dir, filename)
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
        // UUID v4 format: 8-4-4-4-12 hex chars
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
        // Default config (no --log-file) should return None guard
        let cli = cli_from(&[]);
        let guard = init_logging(&cli);
        assert!(guard.is_none(), "No file logging means no guard needed");
    }

    #[test]
    fn test_init_logging_with_file_returns_guard() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("test.log");
        let cli = cli_from(&["--log-file", log_path.to_str().unwrap()]);
        let guard = init_logging(&cli);
        assert!(guard.is_some(), "File logging should return a guard");
    }

    #[test]
    fn test_init_logging_with_json_does_not_panic() {
        let cli = cli_from(&["--log-json"]);
        let _guard = init_logging(&cli);
        // If we get here without panicking, the JSON layer was set up
    }

    #[test]
    fn test_init_logging_with_json_and_file_does_not_panic() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("test.log");
        let cli = cli_from(&["--log-json", "--log-file", log_path.to_str().unwrap()]);
        let guard = init_logging(&cli);
        assert!(guard.is_some(), "File logging should return a guard");
    }

    #[test]
    fn test_split_log_path_absolute() {
        let (dir, file) = split_log_path("/tmp/server.log");
        assert_eq!(dir, "/tmp");
        assert_eq!(file, "server.log");
    }

    #[test]
    fn test_split_log_path_relative() {
        let (dir, file) = split_log_path("logs/output.log");
        assert_eq!(dir, "logs");
        assert_eq!(file, "output.log");
    }

    #[test]
    fn test_split_log_path_filename_only() {
        let (dir, file) = split_log_path("server.log");
        assert_eq!(dir, "");
        assert_eq!(file, "server.log");
    }
}
