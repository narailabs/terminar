use crate::config::TrayConfig;
use crate::health::{GatewayHealth, HealthState};
use crate::service::ServiceManager;
use tauri::State;

#[tauri::command]
pub async fn get_config() -> Result<TrayConfig, String> {
    Ok(TrayConfig::load())
}

#[tauri::command]
pub async fn save_config(config: TrayConfig) -> Result<(), String> {
    config.save()
}

#[tauri::command]
pub async fn get_service_status() -> Result<String, String> {
    let status = ServiceManager::status();
    Ok(serde_json::to_string(&status).unwrap_or_else(|_| "\"unknown\"".to_string()))
}

#[tauri::command]
pub async fn install_service(config: TrayConfig) -> Result<(), String> {
    // Find binaries
    let gateway_bin = ServiceManager::find_binary("terminar-gateway")
        .ok_or("Could not find terminar-gateway binary")?;
    let server_bin = ServiceManager::find_binary("terminar-server")
        .ok_or("Could not find terminar-server binary")?;

    let script = ServiceManager::install_script(&config, &gateway_bin, &server_bin);
    run_elevated(&script)
}

#[tauri::command]
pub async fn uninstall_service() -> Result<(), String> {
    let script = ServiceManager::uninstall_script();
    run_elevated(&script)
}

#[tauri::command]
pub async fn restart_service() -> Result<(), String> {
    let script = ServiceManager::restart_script();
    run_elevated(&script)
}

#[tauri::command]
pub async fn stop_service() -> Result<(), String> {
    let script = ServiceManager::stop_script();
    run_elevated(&script)
}

#[tauri::command]
pub async fn get_health(state: State<'_, HealthState>) -> Result<GatewayHealth, String> {
    Ok(state.health.lock().await.clone())
}

/// Public wrapper for elevated script execution (used by tray menu handlers).
pub fn run_elevated_script(script: &str) -> Result<(), String> {
    run_elevated(script)
}

/// Run a shell script with platform-appropriate elevation.
fn run_elevated(script: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        run_elevated_macos(script)
    }
    #[cfg(target_os = "linux")]
    {
        run_elevated_linux(script)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = script;
        Err("Elevated execution not supported on this platform".to_string())
    }
}

#[cfg(target_os = "macos")]
fn run_elevated_macos(script: &str) -> Result<(), String> {
    // Write script to a temp file, then run via osascript with admin privileges
    let tmp = std::env::temp_dir().join("terminar-service-cmd.sh");
    std::fs::write(&tmp, script).map_err(|e| format!("Failed to write temp script: {e}"))?;

    let escaped_path = tmp.display().to_string().replace('\\', "\\\\").replace('"', "\\\"");
    let osa_script = format!(
        "do shell script \"bash '{escaped_path}'\" with administrator privileges"
    );

    let output = std::process::Command::new("osascript")
        .args(["-e", &osa_script])
        .output()
        .map_err(|e| format!("Failed to run osascript: {e}"))?;

    let _ = std::fs::remove_file(&tmp);

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Elevated command failed: {stderr}"))
    }
}

#[cfg(target_os = "linux")]
fn run_elevated_linux(script: &str) -> Result<(), String> {
    let tmp = std::env::temp_dir().join("terminar-service-cmd.sh");
    std::fs::write(&tmp, script).map_err(|e| format!("Failed to write temp script: {e}"))?;

    let output = std::process::Command::new("pkexec")
        .args(["bash", &tmp.display().to_string()])
        .output()
        .map_err(|e| format!("Failed to run pkexec: {e}"))?;

    let _ = std::fs::remove_file(&tmp);

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Elevated command failed: {stderr}"))
    }
}
