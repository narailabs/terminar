use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use tauri::async_runtime::JoinHandle;

/// Gateway health status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GatewayStatus {
    Running,
    Starting,
    Stopped,
}

/// Health response from the gateway's `/health` endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayHealth {
    pub status: GatewayStatus,
    pub active_servers: Option<usize>,
    pub version: Option<String>,
}

impl Default for GatewayHealth {
    fn default() -> Self {
        Self {
            status: GatewayStatus::Stopped,
            active_servers: None,
            version: None,
        }
    }
}

/// JSON response from the gateway health endpoint.
#[derive(Deserialize)]
struct HealthEndpointResponse {
    #[allow(dead_code)]
    status: String,
    active_servers: usize,
    version: String,
}

/// Poll the gateway's `/health` endpoint once.
pub async fn poll_health(port: u16) -> GatewayHealth {
    let url = format!("http://localhost:{port}/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
            match resp.json::<HealthEndpointResponse>().await {
                Ok(data) => GatewayHealth {
                    status: GatewayStatus::Running,
                    active_servers: Some(data.active_servers),
                    version: Some(data.version),
                },
                // Fallback: endpoint returned 200 but non-JSON (old version)
                Err(_) => GatewayHealth {
                    status: GatewayStatus::Running,
                    active_servers: None,
                    version: None,
                },
            }
        }
        Ok(_) => GatewayHealth {
            status: GatewayStatus::Starting,
            active_servers: None,
            version: None,
        },
        Err(e) => {
            if e.is_timeout() {
                GatewayHealth {
                    status: GatewayStatus::Starting,
                    active_servers: None,
                    version: None,
                }
            } else {
                GatewayHealth::default() // Stopped
            }
        }
    }
}

/// Shared health state accessible from Tauri managed state.
pub struct HealthState {
    pub health: Arc<Mutex<GatewayHealth>>,
}

/// Start a background task that polls gateway health every 5 seconds.
///
/// Emits a `"health-update"` event to the frontend whenever the status changes.
pub fn start_health_poller(app: &AppHandle, port: u16) -> JoinHandle<()> {
    let app_handle = app.clone();
    let health_state = app
        .state::<HealthState>()
        .health
        .clone();

    tauri::async_runtime::spawn(async move {
        let mut last_status = GatewayStatus::Stopped;

        loop {
            let health = poll_health(port).await;
            let status_changed = health.status != last_status;
            last_status = health.status.clone();

            // Update managed state
            *health_state.lock().await = health.clone();

            // Emit event on any status change
            if status_changed {
                let _ = app_handle.emit("health-update", &health);
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_poll_health_stopped() {
        // Polling a port where nothing is listening should return Stopped
        let health = poll_health(19999).await;
        assert_eq!(health.status, GatewayStatus::Stopped);
        assert!(health.active_servers.is_none());
    }

    #[test]
    fn test_default_health() {
        let health = GatewayHealth::default();
        assert_eq!(health.status, GatewayStatus::Stopped);
        assert!(health.active_servers.is_none());
        assert!(health.version.is_none());
    }

    #[test]
    fn test_health_serialization() {
        let health = GatewayHealth {
            status: GatewayStatus::Running,
            active_servers: Some(3),
            version: Some("0.1.0".to_string()),
        };
        let json = serde_json::to_string(&health).unwrap();
        assert!(json.contains("\"running\""));
        assert!(json.contains("3"));
        let deserialized: GatewayHealth = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.status, GatewayStatus::Running);
        assert_eq!(deserialized.active_servers, Some(3));
    }
}
