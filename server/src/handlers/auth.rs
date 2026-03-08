//! Authentication and pairing message handlers.

use crate::AppState;
use crate::messages::ServerMessage;
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::instrument;
use uuid::Uuid;

/// Handle PairRequest: generate and store a pairing code.
#[instrument(skip(tx_out, state), fields(event = "pair_request"))]
pub(crate) async fn handle_pair_request(
    tx_out: &mpsc::Sender<ServerMessage>,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error>> {
    let code = format!("{:08}", Uuid::new_v4().as_u128() % 100_000_000);
    {
        let mut guard = state.pairing_codes.lock();
        guard.insert(code.clone(), (state.api_key.clone(), Instant::now()));
    }
    tx_out
        .send(ServerMessage::PairResponse {
            code,
            expiry_secs: 300,
        })
        .await?;
    Ok(())
}
