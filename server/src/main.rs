use terminar_server::config::Cli;
use terminar_server::run_server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::load();

    let socket_path = cli.socket.clone().unwrap_or_else(|| {
        let uid = unsafe { libc::getuid() };
        format!("/tmp/vscode-terminar-{}.sock", uid)
    });

    run_server(cli, &socket_path).await?;

    Ok(())
}
