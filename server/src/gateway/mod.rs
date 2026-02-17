//! Multi-user gateway for termiNar.
//!
//! The gateway is a reverse proxy that:
//! 1. Terminates TLS and authenticates clients (password or SSH key)
//! 2. Spawns per-user terminar-server instances via `sudo -u <username>`
//! 3. Proxies authenticated WebSocket connections to the user's server
//! 4. Manages idle timeouts and server lifecycle

pub mod config;
pub mod proxy;
pub mod user_server;

use config::GatewayConfig;
use tracing::info;

/// Run the gateway with the given configuration.
///
/// This is the main entry point called from `server/src/bin/gateway.rs`.
/// Full implementation will be wired up in Task 23.
pub async fn run_gateway(config: GatewayConfig) -> Result<(), Box<dyn std::error::Error>> {
    info!(
        port = config.port,
        tls_port = config.tls_port,
        server_bin = %config.server_bin,
        socket_dir = %config.socket_dir,
        "termiNar gateway starting"
    );

    // TODO(Task 23): Initialize audit logger, TLS, UserServerManager,
    // auth verifier, JWT signing key, and axum router.

    Ok(())
}
