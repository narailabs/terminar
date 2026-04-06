//! Theme persistence module.
//!
//! Themes are stored as opaque JSON in `~/.terminar/themes.json`.
//! The server does not interpret or validate theme data — it is a
//! pass-through store. All schema knowledge lives in the web frontend.

use serde_json::Value;
use std::fs;
use std::io;
use std::path::PathBuf;
use tracing::{info, warn};

/// Returns the path to the themes file (~/.terminar/themes.json)
pub fn get_themes_path() -> PathBuf {
    crate::settings::get_settings_dir().join("themes.json")
}

/// Load themes from disk.
/// Returns `None` if the file does not exist or cannot be parsed.
pub fn load_themes() -> Option<Value> {
    let path = get_themes_path();

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(value) => {
                info!("Loaded themes from {:?}", path);
                Some(value)
            }
            Err(e) => {
                warn!("Failed to parse themes file: {}. Returning None.", e);
                None
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            info!("No themes file found");
            None
        }
        Err(e) => {
            warn!("Failed to read themes file: {}. Returning None.", e);
            None
        }
    }
}

/// Save themes to disk.
/// Creates the settings directory if it doesn't exist.
pub fn save_themes(value: &Value) -> Result<(), io::Error> {
    let dir = crate::settings::get_settings_dir();
    let path = get_themes_path();

    if !dir.exists() {
        fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
    }

    let json = serde_json::to_string_pretty(value).map_err(io::Error::other)?;
    fs::write(&path, &json)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    info!("Saved themes to {:?}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_themes_path() {
        let path = get_themes_path();
        assert!(path.ends_with("themes.json"));
    }
}
