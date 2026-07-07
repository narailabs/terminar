//! Settings/themes/tags persistence handlers: GetSettings, PutSettings,
//! GetThemes, PutThemes, GetTags, PutTags.
//!
//! These mirror the HTTP `/settings`, `/themes`, `/tags` endpoints so a
//! client can manage this state over the Unix socket instead of HTTP.

use crate::messages::ServerMessage;
use crate::{settings, tags, themes};

use tokio::sync::mpsc;
use tracing::{error, instrument};

#[instrument(skip(tx_out))]
pub(crate) async fn handle_get_settings(
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let settings = settings::load_settings();
    tx_out
        .send(ServerMessage::SettingsData { settings })
        .await?;
    Ok(())
}

#[instrument(skip(settings, tx_out))]
pub(crate) async fn handle_put_settings(
    settings: &settings::TerminalSettings,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut settings = settings.clone();
    settings.validate();

    match settings::save_settings(&settings) {
        Ok(()) => {
            tx_out
                .send(ServerMessage::SettingsData { settings })
                .await?;
        }
        Err(e) => {
            let msg = format!("Failed to save settings: {}", e);
            error!("{}", msg);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("INTERNAL_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

#[instrument(skip(tx_out))]
pub(crate) async fn handle_get_themes(
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let value = themes::load_themes();
    tx_out.send(ServerMessage::ThemesData { value }).await?;
    Ok(())
}

#[instrument(skip(value, tx_out))]
pub(crate) async fn handle_put_themes(
    value: &serde_json::Value,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    match themes::save_themes(value) {
        Ok(()) => {
            tx_out
                .send(ServerMessage::ThemesData {
                    value: Some(value.clone()),
                })
                .await?;
        }
        Err(e) => {
            let msg = format!("Failed to save themes: {}", e);
            error!("{}", msg);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("INTERNAL_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

#[instrument(skip(tx_out))]
pub(crate) async fn handle_get_tags(
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    let value = tags::load_tags();
    tx_out.send(ServerMessage::TagsData { value }).await?;
    Ok(())
}

#[instrument(skip(value, tx_out))]
pub(crate) async fn handle_put_tags(
    value: &serde_json::Value,
    tx_out: &mpsc::Sender<ServerMessage>,
) -> Result<(), Box<dyn std::error::Error>> {
    match tags::save_tags(value) {
        Ok(()) => {
            tx_out
                .send(ServerMessage::TagsData {
                    value: Some(value.clone()),
                })
                .await?;
        }
        Err(e) => {
            let msg = format!("Failed to save tags: {}", e);
            error!("{}", msg);
            tx_out
                .send(ServerMessage::Error {
                    message: msg,
                    error_code: Some("INTERNAL_ERROR".to_string()),
                })
                .await?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tokio::sync::mpsc;

    fn setup_test_dir() -> (tempfile::TempDir, String) {
        let original_home = std::env::var("HOME").unwrap_or_default();
        let tmp = tempfile::tempdir().unwrap();
        unsafe { std::env::set_var("HOME", tmp.path()) };
        (tmp, original_home)
    }

    fn restore_home(original_home: String) {
        unsafe { std::env::set_var("HOME", original_home) };
    }

    #[tokio::test]
    #[serial]
    async fn test_get_settings_returns_defaults() {
        let (_tmp, original_home) = setup_test_dir();
        let (tx, mut rx) = mpsc::channel(4);

        handle_get_settings(&tx).await.unwrap();

        match rx.recv().await.unwrap() {
            ServerMessage::SettingsData { .. } => {}
            other => panic!("Wrong message type: {:?}", other),
        }
        restore_home(original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_put_then_get_themes_round_trips() {
        let (_tmp, original_home) = setup_test_dir();
        let (tx, mut rx) = mpsc::channel(4);

        let value = serde_json::json!({"foo": "bar"});
        handle_put_themes(&value, &tx).await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::ThemesData { value: Some(v) } => assert_eq!(v, value),
            other => panic!("Wrong message: {:?}", other),
        }

        handle_get_themes(&tx).await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::ThemesData { value: Some(v) } => assert_eq!(v, value),
            other => panic!("Wrong message: {:?}", other),
        }
        restore_home(original_home);
    }

    #[tokio::test]
    #[serial]
    async fn test_get_tags_empty_returns_none() {
        let (_tmp, original_home) = setup_test_dir();
        let (tx, mut rx) = mpsc::channel(4);

        handle_get_tags(&tx).await.unwrap();
        match rx.recv().await.unwrap() {
            ServerMessage::TagsData { value: None } => {}
            other => panic!("Wrong message: {:?}", other),
        }
        restore_home(original_home);
    }
}
