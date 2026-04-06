//! Tag persistence module.
//!
//! Tags are stored as opaque JSON in `~/.terminar/tags.json`.
//! The server does not interpret or validate tag data — it is a
//! pass-through store. All schema knowledge lives in the web frontend.

use serde_json::Value;
use std::fs;
use std::io;
use std::path::PathBuf;
use tracing::{info, warn};

/// Returns the path to the tags file (~/.terminar/tags.json)
pub fn get_tags_path() -> PathBuf {
    crate::settings::get_settings_dir().join("tags.json")
}

/// Load tags from disk.
/// Returns `None` if the file does not exist or cannot be parsed.
pub fn load_tags() -> Option<Value> {
    let path = get_tags_path();

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<Value>(&content) {
            Ok(value) => {
                info!("Loaded tags from {:?}", path);
                Some(value)
            }
            Err(e) => {
                warn!("Failed to parse tags file: {}. Returning None.", e);
                None
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            info!("No tags file found");
            None
        }
        Err(e) => {
            warn!("Failed to read tags file: {}. Returning None.", e);
            None
        }
    }
}

/// Save tags to disk.
/// Creates the settings directory if it doesn't exist.
pub fn save_tags(value: &Value) -> Result<(), io::Error> {
    let dir = crate::settings::get_settings_dir();
    let path = get_tags_path();

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

    info!("Saved tags to {:?}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_tags_path() {
        let path = get_tags_path();
        assert!(path.ends_with("tags.json"));
    }
}
