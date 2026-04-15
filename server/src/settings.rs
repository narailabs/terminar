//! Terminal settings module for persistent user preferences.
//!
//! Settings are stored in `~/.terminar/settings.json`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use tracing::{info, warn};

/// Terminal settings configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    /// Font size in pixels (10-24, default 14)
    #[serde(default = "default_font_size")]
    pub font_size: u8,

    /// Font family name
    #[serde(default = "default_font_family")]
    pub font_family: String,

    /// Font color as hex string (e.g., "#cccccc")
    #[serde(default = "default_font_color")]
    pub font_color: String,

    /// Background color as hex string (e.g., "#1e1e1e")
    #[serde(default = "default_background_color")]
    pub background_color: String,

    /// Cursor style: "block", "underline", or "bar"
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,

    /// Whether the cursor should blink
    #[serde(default = "default_cursor_blink")]
    pub cursor_blink: bool,

    /// Line height multiplier (1.0-2.0, default 1.0)
    #[serde(default = "default_line_height")]
    pub line_height: f32,

    /// Default cwd for new terminal sessions. Empty = $HOME.
    /// Applies only to fresh new terminals — splits and new-in-pane
    /// still inherit the source pane's cwd.
    #[serde(default = "default_default_cwd")]
    pub default_cwd: String,
}

// Default value functions for serde
fn default_font_size() -> u8 {
    14
}
fn default_font_family() -> String {
    "Menlo".to_string()
}
fn default_font_color() -> String {
    "#cccccc".to_string()
}
fn default_background_color() -> String {
    "#1e1e1e".to_string()
}
fn default_cursor_style() -> String {
    "block".to_string()
}
fn default_cursor_blink() -> bool {
    true
}
fn default_line_height() -> f32 {
    1.0
}
fn default_default_cwd() -> String {
    String::new()
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            font_family: default_font_family(),
            font_color: default_font_color(),
            background_color: default_background_color(),
            cursor_style: default_cursor_style(),
            cursor_blink: default_cursor_blink(),
            line_height: default_line_height(),
            default_cwd: default_default_cwd(),
        }
    }
}

impl TerminalSettings {
    /// Validate and clamp settings to valid ranges
    pub fn validate(&mut self) {
        // Clamp font size to 10-24
        self.font_size = self.font_size.clamp(10, 24);

        // Validate font family
        const VALID_FONTS: &[&str] =
            &["Menlo", "Monaco", "Consolas", "Fira Code", "JetBrains Mono"];
        if !VALID_FONTS.contains(&self.font_family.as_str()) {
            warn!("Invalid font family '{}', using default", self.font_family);
            self.font_family = default_font_family();
        }

        // Validate hex colors
        if !is_valid_hex_color(&self.font_color) {
            warn!("Invalid font color '{}', using default", self.font_color);
            self.font_color = default_font_color();
        }
        if !is_valid_hex_color(&self.background_color) {
            warn!(
                "Invalid background color '{}', using default",
                self.background_color
            );
            self.background_color = default_background_color();
        }

        // Validate cursor style
        const VALID_CURSOR_STYLES: &[&str] = &["block", "underline", "bar"];
        if !VALID_CURSOR_STYLES.contains(&self.cursor_style.as_str()) {
            warn!(
                "Invalid cursor style '{}', using default",
                self.cursor_style
            );
            self.cursor_style = default_cursor_style();
        }

        // Clamp line height to 1.0-2.0
        self.line_height = self.line_height.clamp(1.0, 2.0);

        // Trim whitespace from default_cwd. Don't validate path existence here —
        // external drives may be disconnected at load time. Path is re-validated
        // at session creation time in create_local_session.
        self.default_cwd = self.default_cwd.trim().to_string();
    }
}

/// Check if a string is a valid hex color (e.g., "#cccccc")
fn is_valid_hex_color(color: &str) -> bool {
    if color.len() != 7 || !color.starts_with('#') {
        return false;
    }
    color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Returns the path to the settings directory (~/.terminar/)
pub fn get_settings_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".terminar")
}

/// Returns the path to the settings file (~/.terminar/settings.json)
pub fn get_settings_path() -> PathBuf {
    get_settings_dir().join("settings.json")
}

/// Load settings from disk
/// Returns default settings if file doesn't exist or is invalid
pub fn load_settings() -> TerminalSettings {
    let path = get_settings_path();

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<TerminalSettings>(&content) {
            Ok(mut settings) => {
                settings.validate();
                info!("Loaded settings from {:?}", path);
                settings
            }
            Err(e) => {
                warn!("Failed to parse settings file: {}. Using defaults.", e);
                TerminalSettings::default()
            }
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            info!("No settings file found, using defaults");
            TerminalSettings::default()
        }
        Err(e) => {
            warn!("Failed to read settings file: {}. Using defaults.", e);
            TerminalSettings::default()
        }
    }
}

/// Save settings to disk
/// Creates the settings directory if it doesn't exist
pub fn save_settings(settings: &TerminalSettings) -> Result<(), io::Error> {
    let dir = get_settings_dir();
    let path = get_settings_path();

    // Create directory if it doesn't exist
    if !dir.exists() {
        fs::create_dir_all(&dir)?;

        // Set directory permissions to 0700 (owner only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
    }

    // Validate settings before saving
    let mut validated_settings = settings.clone();
    validated_settings.validate();

    // Serialize to pretty JSON
    let json = serde_json::to_string_pretty(&validated_settings).map_err(io::Error::other)?;

    // Write to file
    fs::write(&path, json)?;

    // Set file permissions to 0600 (owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    info!("Saved settings to {:?}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = TerminalSettings::default();
        assert_eq!(settings.font_size, 14);
        assert_eq!(settings.font_family, "Menlo");
        assert_eq!(settings.font_color, "#cccccc");
        assert_eq!(settings.background_color, "#1e1e1e");
        assert_eq!(settings.cursor_style, "block");
        assert!(settings.cursor_blink);
        assert_eq!(settings.line_height, 1.0);
        assert_eq!(settings.default_cwd, "");
    }

    #[test]
    fn test_default_cwd_missing_field() {
        // Pre-existing settings files won't have default_cwd; serde default must fill it.
        let json = "{\"fontSize\":14}";
        let settings: TerminalSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.default_cwd, "");
    }

    #[test]
    fn test_validate_trims_default_cwd() {
        let mut settings = TerminalSettings {
            default_cwd: "  /Users/me/code  ".to_string(),
            ..Default::default()
        };
        settings.validate();
        assert_eq!(settings.default_cwd, "/Users/me/code");
    }

    #[test]
    fn test_validate_clamps_font_size() {
        let mut settings = TerminalSettings {
            font_size: 5,
            ..Default::default()
        };
        settings.validate();
        assert_eq!(settings.font_size, 10);

        settings.font_size = 30;
        settings.validate();
        assert_eq!(settings.font_size, 24);
    }

    #[test]
    fn test_validate_clamps_line_height() {
        let mut settings = TerminalSettings {
            line_height: 0.5,
            ..Default::default()
        };
        settings.validate();
        assert_eq!(settings.line_height, 1.0);

        settings.line_height = 3.0;
        settings.validate();
        assert_eq!(settings.line_height, 2.0);
    }

    #[test]
    fn test_validate_resets_invalid_font_family() {
        let mut settings = TerminalSettings {
            font_family: "InvalidFont".to_string(),
            ..Default::default()
        };
        settings.validate();
        assert_eq!(settings.font_family, "Menlo");
    }

    #[test]
    fn test_validate_resets_invalid_cursor_style() {
        let mut settings = TerminalSettings {
            cursor_style: "invalid".to_string(),
            ..Default::default()
        };
        settings.validate();
        assert_eq!(settings.cursor_style, "block");
    }

    #[test]
    fn test_validate_resets_invalid_colors() {
        let mut settings = TerminalSettings {
            font_color: "invalid".to_string(),
            background_color: "#12345".to_string(),
            ..Default::default()
        };
        settings.validate();
        assert_eq!(settings.font_color, "#cccccc");
        assert_eq!(settings.background_color, "#1e1e1e");
    }

    #[test]
    fn test_is_valid_hex_color() {
        assert!(is_valid_hex_color("#cccccc"));
        assert!(is_valid_hex_color("#FFFFFF"));
        assert!(is_valid_hex_color("#1e1e1e"));
        assert!(is_valid_hex_color("#000000"));

        assert!(!is_valid_hex_color("cccccc"));
        assert!(!is_valid_hex_color("#ccc"));
        assert!(!is_valid_hex_color("#ccccccc"));
        assert!(!is_valid_hex_color("#gggggg"));
        assert!(!is_valid_hex_color(""));
    }

    #[test]
    fn test_serialization() {
        let settings = TerminalSettings::default();
        let json = serde_json::to_string(&settings).unwrap();

        assert!(json.contains("fontSize"));
        assert!(json.contains("fontFamily"));
        assert!(json.contains("fontColor"));
        assert!(json.contains("backgroundColor"));
        assert!(json.contains("cursorStyle"));
        assert!(json.contains("cursorBlink"));
        assert!(json.contains("lineHeight"));
        assert!(json.contains("defaultCwd"));
    }

    #[test]
    fn test_deserialization() {
        // Build JSON string programmatically to avoid raw string issues
        let json = "{\"fontSize\":16,\"fontFamily\":\"Monaco\",\"fontColor\":\"#ffffff\",\"backgroundColor\":\"#000000\",\"cursorStyle\":\"bar\",\"cursorBlink\":false,\"lineHeight\":1.5}";

        let settings: TerminalSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.font_size, 16);
        assert_eq!(settings.font_family, "Monaco");
        assert_eq!(settings.font_color, "#ffffff");
        assert_eq!(settings.background_color, "#000000");
        assert_eq!(settings.cursor_style, "bar");
        assert!(!settings.cursor_blink);
        assert_eq!(settings.line_height, 1.5);
    }

    #[test]
    fn test_deserialization_with_missing_fields() {
        let json = "{\"fontSize\":18}";

        let settings: TerminalSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.font_size, 18);
        assert_eq!(settings.font_family, "Menlo");
        assert_eq!(settings.font_color, "#cccccc");
    }
}
