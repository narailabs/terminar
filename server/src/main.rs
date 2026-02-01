use terminar_server::config::{Cli, Commands};
use terminar_server::{run_server, handle_pair_command};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::load();
    
    // Default socket path logic is in run_server/handle_pair? No, I duplicated it in lib.rs?
    // Let's check lib.rs again.
    // In lib.rs I defined `run_server(cli, socket_path)`.
    // So main needs to compute socket path.
    
    let socket_path = cli.socket.clone().unwrap_or_else(|| {
        let uid = unsafe { libc::getuid() };
        format!("/tmp/vscode-terminar-{}.sock", uid)
    });

    match cli.command {
        Some(Commands::Pair) => {
            handle_pair_command(&socket_path).await?;
        }
        None => {
            run_server(cli, &socket_path).await?;
        }
    }
    
    Ok(())
}
