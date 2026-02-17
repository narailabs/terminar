use crate::config::{TlsMode, TrayConfig};
use crate::health::{GatewayHealth, GatewayStatus};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};
use tauri::{AppHandle, Wry};

/// Build the tray context menu based on current health and config.
pub fn build_menu(
    app: &AppHandle,
    health: &GatewayHealth,
    config: &TrayConfig,
) -> Result<Menu<Wry>, Box<dyn std::error::Error>> {
    // Status line
    let status_icon = match health.status {
        GatewayStatus::Running => "\u{25CF}", // ●
        GatewayStatus::Starting => "\u{25D4}", // ◔
        GatewayStatus::Stopped => "\u{25CB}",  // ○
    };
    let tls_label = match config.tls_mode {
        TlsMode::Auto | TlsMode::Custom => ", TLS",
        TlsMode::Off => "",
    };
    let status_text = format!(
        "Gateway: {} {:?} (port {}{})",
        status_icon, health.status, config.gateway_port, tls_label
    );
    let status_item = MenuItem::with_id(app, "status", &status_text, false, None::<&str>)?;

    // Active servers
    let servers_text = match health.active_servers {
        Some(n) => format!("Active servers: {n}"),
        None => "Active servers: --".to_string(),
    };
    let servers_item = MenuItem::with_id(app, "servers", &servers_text, false, None::<&str>)?;

    // Open Web UI
    let webui_item = MenuItem::with_id(
        app,
        "open-webui",
        "Open Web UI",
        health.status == GatewayStatus::Running,
        None::<&str>,
    )?;

    // Security submenu
    let tls_check = CheckMenuItem::with_id(
        app,
        "toggle-tls",
        "Auto-TLS",
        true,
        config.tls_mode == TlsMode::Auto,
        None::<&str>,
    )?;
    let auth_check = CheckMenuItem::with_id(
        app,
        "toggle-auth",
        "Auth Required",
        true,
        config.require_auth,
        None::<&str>,
    )?;

    let audit_off =
        MenuItem::with_id(app, "audit-off", "Off", true, None::<&str>)?;
    let audit_auth =
        MenuItem::with_id(app, "audit-auth", "Auth Only", true, None::<&str>)?;
    let audit_standard =
        MenuItem::with_id(app, "audit-standard", "Standard", true, None::<&str>)?;
    let audit_verbose =
        MenuItem::with_id(app, "audit-verbose", "Verbose", true, None::<&str>)?;

    let audit_submenu = Submenu::with_items(
        app,
        "Audit Level",
        true,
        &[&audit_off, &audit_auth, &audit_standard, &audit_verbose],
    )?;

    let security_submenu = Submenu::with_items(
        app,
        "Security",
        true,
        &[&tls_check, &auth_check, &audit_submenu],
    )?;

    // Service actions
    let is_running = health.status == GatewayStatus::Running;
    let restart_item = MenuItem::with_id(
        app,
        "restart-service",
        "Restart Service",
        is_running,
        None::<&str>,
    )?;
    let stop_item = MenuItem::with_id(
        app,
        "stop-service",
        "Stop Service",
        is_running,
        None::<&str>,
    )?;
    let settings_item =
        MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    // Build menu
    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &servers_item,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &webui_item,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &security_submenu,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &restart_item,
            &stop_item,
            &settings_item,
            &tauri::menu::PredefinedMenuItem::separator(app)?,
            &quit_item,
        ],
    )?;

    Ok(menu)
}
