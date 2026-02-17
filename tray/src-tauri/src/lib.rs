pub mod commands;
pub mod config;
pub mod health;
pub mod service;
pub mod tray;

use config::TrayConfig;
use health::{GatewayHealth, HealthState};
use service::{ServiceManager, ServiceStatus};

use std::sync::Arc;
use tauri::tray::TrayIconBuilder;
use tauri::{Listener, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(HealthState {
            health: Arc::new(Mutex::new(GatewayHealth::default())),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_service_status,
            commands::install_service,
            commands::uninstall_service,
            commands::restart_service,
            commands::stop_service,
            commands::get_health,
        ])
        .setup(|app| {
            let config = TrayConfig::load();
            let health = GatewayHealth::default();

            // Build initial tray menu
            let menu = tray::build_menu(app.handle(), &health, &config)?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("termiNar Gateway")
                .on_menu_event(move |app, event| {
                    handle_menu_event(app, event.id.as_ref());
                })
                .build(app)?;

            // Listen for health updates and rebuild tray menu
            let app_handle_for_listener = app.handle().clone();
            app.listen("health-update", move |event| {
                if let Ok(health) = serde_json::from_str::<GatewayHealth>(event.payload()) {
                    let config = TrayConfig::load();
                    if let Ok(menu) =
                        tray::build_menu(&app_handle_for_listener, &health, &config)
                    {
                        if let Some(tray) = app_handle_for_listener.tray_by_id("main") {
                            let _ = tray.set_menu(Some(menu));
                        }
                    }
                }
            });

            // Start health polling
            let port = config.gateway_port;
            health::start_health_poller(app.handle(), port);

            // Check if service is installed — if not, show install window
            let service_status = ServiceManager::status();
            if service_status == ServiceStatus::NotInstalled {
                let _window = WebviewWindowBuilder::new(
                    app,
                    "install",
                    WebviewUrl::App("index.html?mode=install".into()),
                )
                .title("Install termiNar Gateway")
                .inner_size(400.0, 350.0)
                .resizable(false)
                .build()?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                // Keep the app running when all windows are closed (tray-only)
                api.prevent_exit();
            }
        });
}

/// Handle tray menu item clicks.
fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        "open-webui" => {
            let config = TrayConfig::load();
            let url = match config.tls_mode {
                config::TlsMode::Off => format!("http://localhost:{}", config.gateway_port),
                _ => format!("https://localhost:{}", config.tls_port),
            };
            let _ = open::that(&url);
        }
        "toggle-tls" => {
            let mut config = TrayConfig::load();
            config.tls_mode = match config.tls_mode {
                config::TlsMode::Auto => config::TlsMode::Off,
                _ => config::TlsMode::Auto,
            };
            let _ = config.save();
        }
        "toggle-auth" => {
            let mut config = TrayConfig::load();
            config.require_auth = !config.require_auth;
            let _ = config.save();
        }
        "audit-off" | "audit-auth" | "audit-standard" | "audit-verbose" => {
            let mut config = TrayConfig::load();
            config.audit_level = id.strip_prefix("audit-").unwrap_or("standard").to_string();
            let _ = config.save();
        }
        "restart-service" => {
            let script = ServiceManager::restart_script();
            let _ = commands::run_elevated_script(&script);
        }
        "stop-service" => {
            let script = ServiceManager::stop_script();
            let _ = commands::run_elevated_script(&script);
        }
        "settings" => {
            // Create or show settings window
            if let Some(window) = app.get_webview_window("settings") {
                let _ = window.show();
                let _ = window.set_focus();
            } else {
                let _ = WebviewWindowBuilder::new(
                    app,
                    "settings",
                    WebviewUrl::App("index.html?mode=settings".into()),
                )
                .title("termiNar Settings")
                .inner_size(500.0, 550.0)
                .build();
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}
