//! Docker container operations: discovery and validation.
//!
//! Supports both local containers (via the default Docker socket) and
//! containers on remote hosts (via `DOCKER_HOST=ssh://user@host:port`, which
//! Docker 18.09+ uses to tunnel the daemon socket over SSH). Callers that want
//! the remote path pass an `Option<&SshConnectionInfo>`; when set, every spawned
//! `docker` subprocess inherits `DOCKER_HOST` pointing at the remote host.

use crate::messages::{ContainerInfo, ServerMessage, SshConnectionInfo};
use tokio::sync::mpsc;

/// Error code / message returned to clients when container ops fail. The
/// classifier maps raw `docker` stderr into a small set of stable codes so
/// the UI can special-case them (e.g., surface an "open SSH editor" action
/// on `SSH_CONNECTION_FAILED`).
pub(crate) struct DockerError {
    pub code: &'static str,
    pub message: String,
}

/// Handle `ListContainers` message.
///
/// If `ssh_connection_id` is set, looks up the saved SSH connection and lists
/// containers on the remote daemon via `DOCKER_HOST=ssh://...`. Otherwise
/// targets the local daemon.
pub(crate) async fn handle_list_containers(
    ssh_connection_id: Option<&str>,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let ssh_conn = match ssh_connection_id {
        Some(id) => match super::ssh::get_connection(id) {
            Some(c) => Some(c),
            None => {
                tx_out
                    .send(ServerMessage::Error {
                        message: format!("SSH connection '{}' not found", id),
                        error_code: Some("SSH_CONNECTION_NOT_FOUND".to_string()),
                    })
                    .await?;
                return Ok(());
            }
        },
        None => None,
    };

    match list_containers(ssh_conn.as_ref()).await {
        Ok(containers) => {
            tx_out
                .send(ServerMessage::ContainerList { containers })
                .await?;
        }
        Err(err) => {
            tx_out
                .send(ServerMessage::Error {
                    message: err.message,
                    error_code: Some(err.code.to_string()),
                })
                .await?;
        }
    }
    Ok(())
}

/// Build a `tokio::process::Command` for `docker`, with `DOCKER_HOST` set to
/// the remote host's ssh URI when `ssh` is `Some`.
///
/// `DOCKER_HOST=ssh://user@host:port` is the native Docker CLI transport
/// (Docker 18.09+, 2019): it tunnels the daemon socket over SSH using the
/// system `ssh` binary (which honors `~/.ssh/config`, agent, keys) and
/// `docker system dial-stdio` on the remote. `docker exec -it` still
/// produces a real local-to-container PTY with clean SIGWINCH semantics.
pub(crate) fn docker_command(ssh: Option<&SshConnectionInfo>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("docker");
    if let Some(conn) = ssh {
        cmd.env("DOCKER_HOST", build_docker_host_uri(conn));
    }
    cmd
}

/// Format the `DOCKER_HOST=ssh://` URI for a connection. IPv6 hosts (those
/// containing a `:`) are wrapped in brackets per RFC 3986.
pub(crate) fn build_docker_host_uri(conn: &SshConnectionInfo) -> String {
    let host = if conn.host.contains(':') && !conn.host.starts_with('[') {
        format!("[{}]", conn.host)
    } else {
        conn.host.clone()
    };
    format!("ssh://{}@{}:{}", conn.user, host, conn.port)
}

/// Reject user/host components that would make the ssh URI ambiguous or
/// unsafe. The URI is passed as a process env var (not through a shell), so
/// this is a belt-and-suspenders validation: it catches malformed values
/// early and keeps the resulting URI to a known-safe character set.
///
/// `host` may contain a single stretch of `:` only when the whole string is
/// enclosed in brackets (already normalized by `build_docker_host_uri`); we
/// validate the raw `SshConnectionInfo` fields *before* that wrapping.
pub(crate) fn validate_ssh_uri_parts(user: &str, host: &str) -> Result<(), String> {
    if user.is_empty() {
        return Err("SSH user is empty".to_string());
    }
    if host.is_empty() {
        return Err("SSH host is empty".to_string());
    }
    if user.len() > 256 || host.len() > 256 {
        return Err("SSH user/host too long".to_string());
    }

    // User: RFC 4254 leaves this loose, but in practice it's a POSIX login
    // name. Allow alphanumeric plus `._-` (plus `@` for user@realm domain
    // logins Docker rejects anyway? No — just keep it strict).
    if user.chars().any(|c| !is_safe_user_char(c)) {
        return Err(format!("SSH user '{}' contains invalid characters", user));
    }

    // Host: hostname or IPv6 literal. Allow alphanumeric, `.`, `-`, `_`, and
    // `:` (for IPv6). Reject whitespace, quotes, and shell metacharacters.
    if host.chars().any(|c| !is_safe_host_char(c)) {
        return Err(format!("SSH host '{}' contains invalid characters", host));
    }

    Ok(())
}

fn is_safe_user_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-'
}

fn is_safe_host_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' || c == ':'
}

/// List running Docker containers via `docker ps`. When `ssh` is `Some`,
/// `DOCKER_HOST` is set on the subprocess.
async fn list_containers(
    ssh: Option<&SshConnectionInfo>,
) -> Result<Vec<ContainerInfo>, DockerError> {
    if let Some(conn) = ssh {
        validate_ssh_uri_parts(&conn.user, &conn.host).map_err(|m| DockerError {
            code: "SSH_CONNECTION_NOT_FOUND",
            message: m,
        })?;
    }

    let output = docker_command(ssh)
        .args(["ps", "--format", "{{json .}}"])
        .output()
        .await
        .map_err(|e| DockerError {
            code: "DOCKER_UNAVAILABLE",
            message: format!("Failed to run docker: {}", e),
        })?;

    if !output.status.success() {
        return Err(classify_docker_error(
            &String::from_utf8_lossy(&output.stderr),
            output.status.code(),
            ssh,
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let containers: Vec<ContainerInfo> = stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(ContainerInfo {
                id: v["ID"].as_str()?.to_string(),
                name: v["Names"].as_str()?.to_string(),
                image: v["Image"].as_str()?.to_string(),
                status: v["Status"].as_str()?.to_string(),
                state: v["State"].as_str()?.to_string(),
            })
        })
        .collect();

    Ok(containers)
}

/// Validate that a container exists and is running. When `ssh` is `Some`,
/// the check runs against the remote daemon.
pub(crate) async fn validate_container(
    container_id: &str,
    ssh: Option<&SshConnectionInfo>,
) -> Result<(), String> {
    // `--` terminates option parsing so a container_id starting with `-` is not
    // interpreted as a Docker flag.
    let output = docker_command(ssh)
        .args(["inspect", "--format", "{{.State.Running}}", "--", container_id])
        .output()
        .await
        .map_err(|e| format!("Docker not available: {}", e))?;

    if !output.status.success() {
        let err = classify_docker_error(
            &String::from_utf8_lossy(&output.stderr),
            output.status.code(),
            ssh,
        );
        return Err(err.message);
    }

    let running = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if running != "true" {
        return Err(format!("Container '{}' is not running", container_id));
    }

    Ok(())
}

/// Look up a container's name by ID, for session naming.
pub(crate) async fn get_container_name(
    container_id: &str,
    ssh: Option<&SshConnectionInfo>,
) -> Option<String> {
    let output = docker_command(ssh)
        .args(["inspect", "--format", "{{.Name}}", "--", container_id])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Docker prefixes names with '/'
    Some(name.trim_start_matches('/').to_string())
}

/// Classify a failed `docker` invocation into a stable error code plus a
/// user-facing message. Called from both `list_containers` and
/// `validate_container` so UI logic can key on the code.
pub(crate) fn classify_docker_error(
    stderr: &str,
    exit_code: Option<i32>,
    ssh: Option<&SshConnectionInfo>,
) -> DockerError {
    let s = stderr.trim();
    let lower = s.to_ascii_lowercase();
    let remote = ssh.is_some();
    let host_hint = ssh.map(|c| c.host.as_str()).unwrap_or("");

    // SSH transport failures — only possible when ssh is Some (DOCKER_HOST
    // parsing happens before anything else, so local-daemon calls won't hit
    // these strings).
    if remote
        && (lower.contains("kex_exchange_identification")
            || lower.contains("connection refused")
            || lower.contains("permission denied")
            || lower.contains("host key verification")
            || lower.contains("could not resolve hostname")
            || lower.contains("no route to host")
            || lower.contains("ssh: connect to host"))
    {
        let first_line = s.lines().next().unwrap_or(s);
        return DockerError {
            code: "SSH_CONNECTION_FAILED",
            message: format!("Cannot reach {}: {}", host_hint, first_line),
        };
    }

    // Docker not installed on the remote: ssh exits 127 with a shell error
    // like "docker: command not found" or "bash: docker: command not found".
    if remote
        && (lower.contains("command not found")
            || (exit_code == Some(127) && lower.contains("docker")))
    {
        return DockerError {
            code: "REMOTE_DOCKER_MISSING",
            message: format!("Docker isn't installed on {}", host_hint),
        };
    }

    // Specific container misses (from `docker inspect`).
    if lower.contains("no such container") || lower.contains("no such object") {
        return DockerError {
            code: "CONTAINER_NOT_FOUND",
            message: s.to_string(),
        };
    }

    // Generic fallback — local or remote Docker daemon unreachable.
    DockerError {
        code: "DOCKER_UNAVAILABLE",
        message: if remote {
            format!("Docker error on {}: {}", host_hint, s)
        } else {
            format!("Docker error: {}", s)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn(user: &str, host: &str, port: u16) -> SshConnectionInfo {
        SshConnectionInfo {
            id: "test-id".to_string(),
            name: "test".to_string(),
            host: host.to_string(),
            user: user.to_string(),
            port,
        }
    }

    // ---- build_docker_host_uri ----

    #[test]
    fn build_uri_ipv4() {
        assert_eq!(
            build_docker_host_uri(&conn("root", "203.0.113.5", 22)),
            "ssh://root@203.0.113.5:22"
        );
    }

    #[test]
    fn build_uri_hostname() {
        assert_eq!(
            build_docker_host_uri(&conn("deploy", "corp.example.com", 2222)),
            "ssh://deploy@corp.example.com:2222"
        );
    }

    #[test]
    fn build_uri_ipv6_brackets() {
        assert_eq!(
            build_docker_host_uri(&conn("root", "::1", 22)),
            "ssh://root@[::1]:22"
        );
    }

    #[test]
    fn build_uri_ipv6_already_bracketed() {
        // If upstream ever pre-brackets, don't double-bracket.
        assert_eq!(
            build_docker_host_uri(&conn("root", "[fe80::1]", 22)),
            "ssh://root@[fe80::1]:22"
        );
    }

    // ---- validate_ssh_uri_parts ----

    #[test]
    fn validate_accepts_typical_values() {
        assert!(validate_ssh_uri_parts("root", "example.com").is_ok());
        assert!(validate_ssh_uri_parts("deploy-user", "host-1.internal").is_ok());
        assert!(validate_ssh_uri_parts("u_1", "::1").is_ok());
    }

    #[test]
    fn validate_rejects_shell_metachars_in_host() {
        assert!(validate_ssh_uri_parts("root", "evil;rm -rf").is_err());
        assert!(validate_ssh_uri_parts("root", "$(hostname)").is_err());
        assert!(validate_ssh_uri_parts("root", "host with space").is_err());
        assert!(validate_ssh_uri_parts("root", "host\nnewline").is_err());
    }

    #[test]
    fn validate_rejects_shell_metachars_in_user() {
        assert!(validate_ssh_uri_parts("$(x)", "host").is_err());
        assert!(validate_ssh_uri_parts("root;rm", "host").is_err());
        assert!(validate_ssh_uri_parts("root@realm", "host").is_err());
    }

    #[test]
    fn validate_rejects_empty() {
        assert!(validate_ssh_uri_parts("", "host").is_err());
        assert!(validate_ssh_uri_parts("root", "").is_err());
    }

    // ---- docker_command env plumbing ----

    #[test]
    fn docker_command_local_has_no_docker_host() {
        let cmd = docker_command(None);
        let envs: Vec<_> = cmd.as_std().get_envs().collect();
        assert!(
            !envs.iter().any(|(k, _)| k == &std::ffi::OsStr::new("DOCKER_HOST")),
            "local docker_command should not set DOCKER_HOST"
        );
    }

    #[test]
    fn docker_command_remote_sets_docker_host() {
        let c = conn("deploy", "10.0.0.5", 22);
        let cmd = docker_command(Some(&c));
        let envs: Vec<_> = cmd.as_std().get_envs().collect();
        let docker_host = envs
            .iter()
            .find(|(k, _)| k == &std::ffi::OsStr::new("DOCKER_HOST"))
            .expect("DOCKER_HOST should be set for remote docker_command");
        assert_eq!(
            docker_host.1.and_then(|v| v.to_str()),
            Some("ssh://deploy@10.0.0.5:22")
        );
    }

    // ---- classify_docker_error ----

    fn remote_conn() -> SshConnectionInfo {
        conn("deploy", "prod.example.com", 22)
    }

    #[test]
    fn classify_ssh_connection_refused() {
        let err = classify_docker_error(
            "ssh: connect to host prod.example.com port 22: Connection refused",
            Some(255),
            Some(&remote_conn()),
        );
        assert_eq!(err.code, "SSH_CONNECTION_FAILED");
        assert!(err.message.contains("prod.example.com"));
    }

    #[test]
    fn classify_ssh_permission_denied() {
        let err = classify_docker_error(
            "Permission denied (publickey).",
            Some(255),
            Some(&remote_conn()),
        );
        assert_eq!(err.code, "SSH_CONNECTION_FAILED");
    }

    #[test]
    fn classify_ssh_host_key_verification() {
        let err = classify_docker_error(
            "Host key verification failed.",
            Some(255),
            Some(&remote_conn()),
        );
        assert_eq!(err.code, "SSH_CONNECTION_FAILED");
    }

    #[test]
    fn classify_ssh_unknown_host() {
        let err = classify_docker_error(
            "ssh: Could not resolve hostname foo.invalid: Name or service not known",
            Some(255),
            Some(&remote_conn()),
        );
        assert_eq!(err.code, "SSH_CONNECTION_FAILED");
    }

    #[test]
    fn classify_remote_docker_missing() {
        let err = classify_docker_error(
            "bash: docker: command not found",
            Some(127),
            Some(&remote_conn()),
        );
        assert_eq!(err.code, "REMOTE_DOCKER_MISSING");
    }

    #[test]
    fn classify_container_not_found() {
        let err = classify_docker_error(
            "Error: No such container: deadbeef",
            Some(1),
            None,
        );
        assert_eq!(err.code, "CONTAINER_NOT_FOUND");
    }

    #[test]
    fn classify_local_fallback() {
        let err = classify_docker_error(
            "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
            Some(1),
            None,
        );
        assert_eq!(err.code, "DOCKER_UNAVAILABLE");
        assert!(err.message.contains("Docker error"));
    }

    #[test]
    fn classify_does_not_flag_local_as_ssh() {
        // Same string that would trigger SSH_CONNECTION_FAILED if remote must
        // NOT do so when ssh is None — the guard is defensive but let's
        // assert it.
        let err = classify_docker_error(
            "Connection refused",
            Some(1),
            None,
        );
        assert_eq!(err.code, "DOCKER_UNAVAILABLE");
    }
}
