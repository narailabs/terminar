use clap::Parser;
use terminar_server::gateway::{config::GatewayConfig, run_gateway};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = GatewayConfig::parse();
    run_gateway(config).await
}
