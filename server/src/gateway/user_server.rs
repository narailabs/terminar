//! Per-user server lifecycle management.
//!
//! The `UserServerManager` spawns and tracks terminar-server instances
//! running in `--user-mode`, one per authenticated user. Each server
//! listens on a Unix socket in the configured socket directory and is
//! launched via `sudo -u <username>` for privilege separation.

use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::Mutex;
use tracing::{info, warn, error};

/// Validate a username before using it in paths or commands.
///
/// Rejects:
/// - Empty usernames
/// - Usernames containing `/`, `\`, or null bytes
/// - Usernames starting with `.` or `-`
/// - Usernames longer than 32 characters
fn validate_username(username: &str) -> Result<(), String> {
    if username.is_empty() {
        return Err("username must not be empty".to_string());
    }
    if username.len() > 32 {
        return Err(format!(
            "username '{}' exceeds maximum length of 32 characters",
            username
        ));
    }
    if username.starts_with('.') || username.starts_with('-') {
        return Err(format!(
            "username '{}' must not start with '.' or '-'",
            username
        ));
    }
    if username.contains('/') || username.contains('\\') || username.contains('\0') {
        return Err(format!(
            "username '{}' contains forbidden characters (/, \\, or null)",
            username
        ));
    }
    Ok(())
}

/// Information about a running per-user server instance.
pub struct UserServerInfo {
    /// Path to the Unix domain socket this server listens on.
    pub socket_path: String,
    /// PID of the server process.
    pub pid: u32,
    /// Last time a client was proxied to this server.
    pub last_active: Instant,
}

/// Manages the lifecycle of per-user terminar-server instances.
///
/// The gateway spawns one server per authenticated user. Each server
/// runs as that user (via `sudo -u`) in `--user-mode` and listens
/// on a Unix socket at `<socket_dir>/<username>.sock`.
pub struct UserServerManager {
    server_bin: String,
    socket_dir: String,
    idle_timeout: Duration,
    servers: Mutex<HashMap<String, UserServerInfo>>,
}

impl UserServerManager {
    pub fn new(server_bin: &str, socket_dir: &str, idle_timeout_secs: u64) -> Self {
        Self {
            server_bin: server_bin.to_string(),
            socket_dir: socket_dir.to_string(),
            idle_timeout: Duration::from_secs(idle_timeout_secs),
            servers: Mutex::new(HashMap::new()),
        }
    }

    /// Build the command to spawn a per-user server.
    ///
    /// Returns a `Command` configured to run:
    ///   `sudo -u <username> <server_bin> --user-mode --socket <socket_dir>/<username>.sock`
    ///
    /// The caller must validate the username before calling this function.
    pub fn build_spawn_command(&self, username: &str) -> Command {
        let socket_path = format!("{}/{}.sock", self.socket_dir, username);
        let mut cmd = Command::new("sudo");
        cmd.arg("-u")
            .arg(username)
            .arg(&self.server_bin)
            .arg("--user-mode")
            .arg("--socket")
            .arg(&socket_path);
        cmd
    }

    /// Return the socket path for a given username.
    ///
    /// The caller must validate the username before calling this function.
    pub fn socket_path_for(&self, username: &str) -> String {
        format!("{}/{}.sock", self.socket_dir, username)
    }

    /// Ensure a server is running for the given user.
    ///
    /// If a server is already tracked and its socket exists, touch its
    /// `last_active` timestamp and return the socket path. Otherwise,
    /// spawn a new server and wait for its socket to appear.
    pub async fn ensure_server(&self, username: &str) -> Result<String, String> {
        // Validate the username before constructing any paths or commands
        validate_username(username)?;

        let socket_path = self.socket_path_for(username);

        // Check if we already have a running server for this user
        {
            let mut servers = self.servers.lock().await;
            if let Some(info) = servers.get_mut(username) {
                if Path::new(&info.socket_path).exists() {
                    info.last_active = Instant::now();
                    return Ok(info.socket_path.clone());
                }
                // Socket gone -- server must have crashed, remove stale entry
                warn!(username, "per-user server socket missing, respawning");
                servers.remove(username);
            }
        }

        // Spawn a new server
        info!(username, socket_path = %socket_path, "spawning per-user server");
        let mut cmd = self.build_spawn_command(username);
        let mut child = cmd.spawn().map_err(|e| {
            format!("failed to spawn server for user {}: {}", username, e)
        })?;

        let pid = child.id().unwrap_or(0);

        // Wait for the socket to appear (poll with timeout)
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if Path::new(&socket_path).exists() {
                break;
            }
            if Instant::now() > deadline {
                error!(username, "timed out waiting for per-user server socket");
                return Err(format!(
                    "timed out waiting for server socket for user {}",
                    username
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Spawn a background task to reap the child process when it exits.
        // This prevents zombie processes and logs unexpected exits.
        let username_for_reaper = username.to_string();
        tokio::spawn(async move {
            match child.wait().await {
                Ok(status) => {
                    warn!(
                        username = %username_for_reaper,
                        pid,
                        status = %status,
                        "per-user server process exited"
                    );
                }
                Err(e) => {
                    error!(
                        username = %username_for_reaper,
                        pid,
                        "failed to wait on per-user server process: {}",
                        e
                    );
                }
            }
        });

        // Track the new server
        let info = UserServerInfo {
            socket_path: socket_path.clone(),
            pid,
            last_active: Instant::now(),
        };
        self.servers.lock().await.insert(username.to_string(), info);

        info!(username, pid, "per-user server ready");
        Ok(socket_path)
    }

    /// Shut down servers that have been idle longer than `idle_timeout`.
    ///
    /// Called periodically by the gateway's background task.
    pub async fn shutdown_idle_servers(&self) {
        let mut servers = self.servers.lock().await;
        let now = Instant::now();
        let mut to_remove = Vec::new();

        for (username, info) in servers.iter() {
            if now.duration_since(info.last_active) > self.idle_timeout {
                info!(
                    username,
                    pid = info.pid,
                    "shutting down idle per-user server"
                );
                // Send SIGTERM to the server process using nix for safety
                #[cfg(unix)]
                {
                    use nix::sys::signal::{kill, Signal};
                    use nix::unistd::Pid;
                    if let Err(e) = kill(Pid::from_raw(info.pid as i32), Signal::SIGTERM) {
                        warn!(
                            username,
                            pid = info.pid,
                            "failed to send SIGTERM to per-user server: {}",
                            e
                        );
                    }
                }
                // Clean up the socket file
                let _ = std::fs::remove_file(&info.socket_path);
                to_remove.push(username.clone());
            }
        }

        for username in to_remove {
            servers.remove(&username);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_username_valid() {
        assert!(validate_username("alice").is_ok());
        assert!(validate_username("bob_123").is_ok());
        assert!(validate_username("user.name").is_ok());
        assert!(validate_username("a").is_ok());
    }

    #[test]
    fn test_validate_username_empty() {
        assert!(validate_username("").is_err());
        assert!(validate_username("").unwrap_err().contains("empty"));
    }

    #[test]
    fn test_validate_username_too_long() {
        let long_name = "a".repeat(33);
        assert!(validate_username(&long_name).is_err());
        assert!(validate_username(&long_name).unwrap_err().contains("32"));
    }

    #[test]
    fn test_validate_username_starts_with_dot() {
        assert!(validate_username(".hidden").is_err());
    }

    #[test]
    fn test_validate_username_starts_with_dash() {
        assert!(validate_username("-flag").is_err());
    }

    #[test]
    fn test_validate_username_contains_slash() {
        assert!(validate_username("../etc").is_err());
        assert!(validate_username("user/name").is_err());
    }

    #[test]
    fn test_validate_username_contains_backslash() {
        assert!(validate_username("user\\name").is_err());
    }

    #[test]
    fn test_validate_username_contains_null() {
        assert!(validate_username("user\0name").is_err());
    }

    #[test]
    fn test_validate_username_32_chars_ok() {
        let name = "a".repeat(32);
        assert!(validate_username(&name).is_ok());
    }

    #[test]
    fn test_user_server_spawn_command() {
        let manager = UserServerManager::new(
            "/usr/local/bin/terminar-server",
            "/run/terminar",
            1800,
        );
        let cmd = manager.build_spawn_command("alice");
        assert_eq!(cmd.as_std().get_program(), "sudo");
        let args: Vec<&str> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_str().unwrap())
            .collect();
        assert_eq!(
            args,
            vec![
                "-u",
                "alice",
                "/usr/local/bin/terminar-server",
                "--user-mode",
                "--socket",
                "/run/terminar/alice.sock",
            ]
        );
    }

    #[test]
    fn test_socket_path_for() {
        let manager = UserServerManager::new(
            "/usr/local/bin/terminar-server",
            "/run/terminar",
            1800,
        );
        assert_eq!(
            manager.socket_path_for("alice"),
            "/run/terminar/alice.sock"
        );
        assert_eq!(
            manager.socket_path_for("bob"),
            "/run/terminar/bob.sock"
        );
    }

    #[test]
    fn test_manager_creation() {
        let manager = UserServerManager::new(
            "terminar-server",
            "/tmp/terminar",
            3600,
        );
        assert_eq!(manager.server_bin, "terminar-server");
        assert_eq!(manager.socket_dir, "/tmp/terminar");
        assert_eq!(manager.idle_timeout, Duration::from_secs(3600));
    }
}
