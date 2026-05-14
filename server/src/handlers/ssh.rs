//! SSH connection management: CRUD, config parser, lookup.
//!
//! Stores connections in ~/.terminar/ssh-connections.json.
//! Reads (but never writes) ~/.ssh/config for import.
//! No passwords or keys stored — SSH handles all authentication.

use crate::messages::{ServerMessage, SshConfigHost, SshConnectionInfo};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::sync::mpsc;
use tracing::warn;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ConnectionsFile {
    #[serde(default)]
    connections: Vec<SshConnectionInfo>,
}

/// In-memory cache of the connections file, loaded on first access.
static CONNECTIONS: OnceLock<Mutex<Vec<SshConnectionInfo>>> = OnceLock::new();

fn get_cache() -> &'static Mutex<Vec<SshConnectionInfo>> {
    CONNECTIONS.get_or_init(|| Mutex::new(load_connections_file()))
}

/// Path to the ssh-connections.json file under the settings directory.
fn get_connections_path() -> PathBuf {
    crate::settings::get_settings_dir().join("ssh-connections.json")
}

/// Load connections from disk. Returns empty vec if file doesn't exist or is corrupt.
fn load_connections_file() -> Vec<SshConnectionInfo> {
    let path = get_connections_path();
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<ConnectionsFile>(&content) {
            Ok(file) => file.connections,
            Err(e) => {
                warn!("Failed to parse ssh-connections.json: {}", e);
                Vec::new()
            }
        },
        Err(e) => {
            warn!("Failed to read ssh-connections.json: {}", e);
            Vec::new()
        }
    }
}

/// Atomically write connections to disk.
fn save_connections_file(conns: &[SshConnectionInfo]) -> Result<(), String> {
    let path = get_connections_path();
    let parent = path
        .parent()
        .ok_or_else(|| format!("No parent directory for {:?}", path))?;
    if !parent.exists() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {:?}: {}", parent, e))?;
    }

    let file = ConnectionsFile {
        connections: conns.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Failed to serialize connections: {}", e))?;

    // Atomic write via temp file + rename
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    use std::io::Write;
    tmp.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    tmp.flush()
        .map_err(|e| format!("Failed to flush temp file: {}", e))?;

    // Set 0600 permissions BEFORE persist to close the world-readable window
    // (temp file inherits the persisted path, so perms carry over).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o600))
        {
            warn!(
                "Failed to set permissions on ssh-connections tempfile: {}",
                e
            );
        }
    }

    tmp.persist(&path)
        .map_err(|e| format!("Failed to rename temp file: {}", e))?;

    Ok(())
}

/// Public API: look up a connection by ID. Used by session handler for SSH spawn.
pub fn get_connection(id: &str) -> Option<SshConnectionInfo> {
    let cache = get_cache().lock();
    cache.iter().find(|c| c.id == id).cloned()
}

/// List all connections.
fn list_connections() -> Vec<SshConnectionInfo> {
    get_cache().lock().clone()
}

/// Add a new connection. Generates a UUID. Returns the new connection.
///
/// The cache lock is held across the disk write to prevent write-after-unlock
/// races where two concurrent adds/updates could overwrite each other.
fn add_connection(
    name: &str,
    host: &str,
    user: &str,
    port: u16,
) -> Result<SshConnectionInfo, String> {
    let conn = SshConnectionInfo {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        host: host.to_string(),
        user: user.to_string(),
        port,
    };
    let mut cache = get_cache().lock();
    cache.push(conn.clone());
    save_connections_file(&cache)?;
    Ok(conn)
}

/// Update an existing connection.
fn update_connection(
    id: &str,
    name: &str,
    host: &str,
    user: &str,
    port: u16,
) -> Result<(), String> {
    let mut cache = get_cache().lock();
    let conn = cache
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("SSH connection '{}' not found", id))?;
    conn.name = name.to_string();
    conn.host = host.to_string();
    conn.user = user.to_string();
    conn.port = port;
    save_connections_file(&cache)?;
    Ok(())
}

/// Remove a connection.
fn remove_connection(id: &str) -> Result<(), String> {
    let mut cache = get_cache().lock();
    let len_before = cache.len();
    cache.retain(|c| c.id != id);
    if cache.len() == len_before {
        return Err(format!("SSH connection '{}' not found", id));
    }
    save_connections_file(&cache)?;
    Ok(())
}

/// Parse ~/.ssh/config for importable host entries.
///
/// Simple parser: reads Host blocks, extracts HostName/User/Port.
/// Skips wildcards (`*`, `?`) and Include directives. Entering a `Match`
/// block ends the current Host block (directives inside Match are ignored).
pub(crate) fn parse_ssh_config(path: &Path) -> Vec<SshConfigHost> {
    let content = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let mut hosts = Vec::new();
    let mut current: Option<SshConfigHost> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Support both `Key Value` and `Key=Value` syntaxes
        let (key, value) = match line.find(|c: char| c.is_whitespace() || c == '=') {
            Some(idx) => {
                let (k, rest) = line.split_at(idx);
                let v = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
                (k.to_lowercase(), v.trim())
            }
            None => continue,
        };

        if key == "host" {
            // Save previous host if any (skip wildcards)
            if let Some(h) = current.take()
                && !h.name.contains('*')
                && !h.name.contains('?')
            {
                hosts.push(h);
            }
            // Host line may have multiple names; take the first
            let first_name = value.split_whitespace().next().unwrap_or("").to_string();
            if !first_name.is_empty() {
                current = Some(SshConfigHost {
                    name: first_name,
                    hostname: None,
                    user: None,
                    port: None,
                });
            }
        } else if key == "match" {
            // Match blocks end the current Host block. We don't parse directives
            // inside a Match (they'd require knowing the runtime target). Save the
            // previous host so its directives don't leak into the Match.
            if let Some(h) = current.take()
                && !h.name.contains('*')
                && !h.name.contains('?')
            {
                hosts.push(h);
            }
            // current stays None until the next Host directive.
        } else if key == "include" {
            // Include directives are not followed. Users can re-import after
            // editing ~/.ssh/config directly. Save the current host to avoid
            // treating Include as a host directive, but keep parsing in case
            // there are more Host blocks after the Include.
            // (current stays intact — Include doesn't terminate a Host block.)
        } else if let Some(ref mut h) = current {
            match key.as_str() {
                "hostname" => h.hostname = Some(value.to_string()),
                "user" => h.user = Some(value.to_string()),
                "port" => h.port = value.parse().ok(),
                _ => {}
            }
        }
    }

    // Save last host
    if let Some(h) = current
        && !h.name.contains('*')
        && !h.name.contains('?')
    {
        hosts.push(h);
    }

    hosts
}

/// Locate the user's ~/.ssh/config path.
fn get_ssh_config_path() -> PathBuf {
    match std::env::var("HOME") {
        Ok(home) => PathBuf::from(home).join(".ssh").join("config"),
        Err(_) => PathBuf::from("/dev/null"),
    }
}

// === Message handlers ===

pub(crate) async fn handle_list_ssh_connections(
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let connections = list_connections();
    tx_out
        .send(ServerMessage::SshConnectionList { connections })
        .await?;
    Ok(())
}

pub(crate) async fn handle_add_ssh_connection(
    name: &str,
    host: &str,
    user: &str,
    port: u16,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Validate
    if name.is_empty() || host.is_empty() || user.is_empty() {
        tx_out
            .send(ServerMessage::Error {
                message: "name, host, and user are required".to_string(),
                error_code: Some("INVALID_INPUT".to_string()),
            })
            .await?;
        return Ok(());
    }

    match add_connection(name, host, user, port) {
        Ok(_) => {
            let connections = list_connections();
            tx_out
                .send(ServerMessage::SshConnectionList { connections })
                .await?;
        }
        Err(msg) => {
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("SSH_CONNECTION_ERROR".to_string()),
                })
                .await?;
        }
    }
    Ok(())
}

pub(crate) async fn handle_update_ssh_connection(
    id: &str,
    name: &str,
    host: &str,
    user: &str,
    port: u16,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    if name.is_empty() || host.is_empty() || user.is_empty() {
        tx_out
            .send(ServerMessage::Error {
                message: "name, host, and user are required".to_string(),
                error_code: Some("INVALID_INPUT".to_string()),
            })
            .await?;
        return Ok(());
    }

    match update_connection(id, name, host, user, port) {
        Ok(()) => {
            let connections = list_connections();
            tx_out
                .send(ServerMessage::SshConnectionList { connections })
                .await?;
        }
        Err(msg) => {
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("SSH_CONNECTION_ERROR".to_string()),
                })
                .await?;
        }
    }
    Ok(())
}

pub(crate) async fn handle_remove_ssh_connection(
    id: &str,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    match remove_connection(id) {
        Ok(()) => {
            let connections = list_connections();
            tx_out
                .send(ServerMessage::SshConnectionList { connections })
                .await?;
        }
        Err(msg) => {
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("SSH_CONNECTION_ERROR".to_string()),
                })
                .await?;
        }
    }
    Ok(())
}

pub(crate) async fn handle_import_ssh_config(
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let path = get_ssh_config_path();
    let hosts = parse_ssh_config(&path);
    tx_out
        .send(ServerMessage::SshConfigImportResult { hosts })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_parse_ssh_config_basic() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
Host production
    HostName prod.example.com
    User deploy
    Port 2222

Host staging
    HostName staging.example.com
    User deploy
"#;
        std::fs::write(tmp.path(), content).unwrap();
        let hosts = parse_ssh_config(tmp.path());
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "production");
        assert_eq!(hosts[0].hostname, Some("prod.example.com".to_string()));
        assert_eq!(hosts[0].user, Some("deploy".to_string()));
        assert_eq!(hosts[0].port, Some(2222));
        assert_eq!(hosts[1].name, "staging");
        assert_eq!(hosts[1].hostname, Some("staging.example.com".to_string()));
        assert_eq!(hosts[1].port, None);
    }

    #[test]
    fn test_parse_ssh_config_skips_wildcards() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
Host *
    User default
    ServerAliveInterval 30

Host prod
    HostName prod.example.com

Host *.internal
    User internal
"#;
        std::fs::write(tmp.path(), content).unwrap();
        let hosts = parse_ssh_config(tmp.path());
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "prod");
    }

    #[test]
    fn test_parse_ssh_config_key_equals_value() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
Host prod
    HostName=prod.example.com
    User=deploy
    Port=22
"#;
        std::fs::write(tmp.path(), content).unwrap();
        let hosts = parse_ssh_config(tmp.path());
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname, Some("prod.example.com".to_string()));
        assert_eq!(hosts[0].user, Some("deploy".to_string()));
        assert_eq!(hosts[0].port, Some(22));
    }

    #[test]
    fn test_parse_ssh_config_missing_file() {
        let hosts = parse_ssh_config(Path::new("/nonexistent/path/ssh_config"));
        assert!(hosts.is_empty());
    }

    #[test]
    fn test_parse_ssh_config_with_comments() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
# My SSH config
Host prod
    HostName prod.example.com
    # User is deploy
    User deploy
"#;
        std::fs::write(tmp.path(), content).unwrap();
        let hosts = parse_ssh_config(tmp.path());
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "prod");
        assert_eq!(hosts[0].user, Some("deploy".to_string()));
    }

    #[test]
    fn test_parse_ssh_config_multiple_names_takes_first() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, "Host prod prod-alt\n    HostName prod.example.com").unwrap();
        let hosts = parse_ssh_config(file.path());
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "prod");
    }

    #[test]
    fn test_parse_ssh_config_match_ends_host_block() {
        // Directives after `Match` must NOT leak into the prior Host block.
        // Without the Match handling, the `User bastion` and `HostName 10.0.0.1`
        // would be applied to the `prod` host.
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
Host prod
    HostName prod.example.com
    User deploy

Match user bastion
    HostName 10.0.0.1
    User bastion

Host staging
    HostName staging.example.com
"#;
        std::fs::write(tmp.path(), content).unwrap();
        let hosts = parse_ssh_config(tmp.path());
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "prod");
        assert_eq!(hosts[0].hostname, Some("prod.example.com".to_string()));
        assert_eq!(hosts[0].user, Some("deploy".to_string()));
        // Match directives were NOT mis-assigned to prod
        assert_eq!(hosts[1].name, "staging");
        assert_eq!(hosts[1].hostname, Some("staging.example.com".to_string()));
    }

    #[test]
    fn test_parse_ssh_config_include_is_skipped() {
        // `Include` directives are not followed. A Host before an Include
        // should still be captured; a Host after an Include should also be
        // captured (Include doesn't terminate a Host block but also doesn't
        // bring in the included file's entries).
        let tmp = tempfile::NamedTempFile::new().unwrap();
        let content = r#"
Host prod
    HostName prod.example.com
    User deploy

Include ~/.ssh/config.d/*

Host staging
    HostName staging.example.com
"#;
        std::fs::write(tmp.path(), content).unwrap();
        let hosts = parse_ssh_config(tmp.path());
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "prod");
        assert_eq!(hosts[0].hostname, Some("prod.example.com".to_string()));
        assert_eq!(hosts[1].name, "staging");
        assert_eq!(hosts[1].hostname, Some("staging.example.com".to_string()));
    }
}
