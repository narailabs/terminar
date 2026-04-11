//! Docker container operations: discovery and validation.

use crate::messages::{ContainerInfo, ServerMessage};
use tokio::sync::mpsc;

/// Handle ListContainers message.
pub(crate) async fn handle_list_containers(
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    match list_containers().await {
        Ok(containers) => {
            tx_out
                .send(ServerMessage::ContainerList { containers })
                .await?;
        }
        Err(msg) => {
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("DOCKER_UNAVAILABLE".to_string()),
                })
                .await?;
        }
    }
    Ok(())
}

/// List running Docker containers via `docker ps`.
async fn list_containers() -> Result<Vec<ContainerInfo>, String> {
    let output = tokio::process::Command::new("docker")
        .args(["ps", "--format", "{{json .}}"])
        .output()
        .await
        .map_err(|e| format!("Failed to run docker: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("docker ps failed: {}", stderr.trim()));
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

/// Validate that a container exists and is running.
pub(crate) async fn validate_container(container_id: &str) -> Result<(), String> {
    // `--` terminates option parsing so a container_id starting with `-` is not
    // interpreted as a Docker flag.
    let output = tokio::process::Command::new("docker")
        .args(["inspect", "--format", "{{.State.Running}}", "--", container_id])
        .output()
        .await
        .map_err(|e| format!("Docker not available: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Container '{}' not found: {}", container_id, stderr));
    }

    let running = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if running != "true" {
        return Err(format!(
            "Container '{}' is not running",
            container_id
        ));
    }

    Ok(())
}

/// Look up a container's name by ID, for session naming.
pub(crate) async fn get_container_name(container_id: &str) -> Option<String> {
    let output = tokio::process::Command::new("docker")
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
