use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// TLS configuration mode for the gateway.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TlsMode {
    Off,
    Auto,
    Custom,
}

/// Persistent configuration for the tray app, stored at `~/.terminar/tray-config.json`.
///
/// These settings map to gateway CLI arguments and are used when generating
/// service install scripts and plist/systemd unit files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrayConfig {
    /// Gateway HTTP port (default: 3000)
    #[serde(default = "default_gateway_port")]
    pub gateway_port: u16,

    /// TLS mode: Off, Auto (self-signed), or Custom (user-provided cert)
    #[serde(default = "default_tls_mode")]
    pub tls_mode: TlsMode,

    /// Path to TLS certificate (PEM), used when tls_mode is Custom
    #[serde(default)]
    pub tls_cert: Option<String>,

    /// Path to TLS private key (PEM), used when tls_mode is Custom
    #[serde(default)]
    pub tls_key: Option<String>,

    /// TLS/HTTPS listener port (default: 8444)
    #[serde(default = "default_tls_port")]
    pub tls_port: u16,

    /// Whether to require authentication (default: true)
    #[serde(default = "default_require_auth")]
    pub require_auth: bool,

    /// Audit log level: off, auth, standard, verbose (default: "standard")
    #[serde(default = "default_audit_level")]
    pub audit_level: String,

    /// Idle timeout in seconds before shutting down per-user servers (default: 1800)
    #[serde(default = "default_idle_timeout")]
    pub idle_timeout: u64,
}

fn default_gateway_port() -> u16 {
    3000
}
fn default_tls_mode() -> TlsMode {
    TlsMode::Auto
}
fn default_tls_port() -> u16 {
    8444
}
fn default_require_auth() -> bool {
    true
}
fn default_audit_level() -> String {
    "standard".to_string()
}
fn default_idle_timeout() -> u64 {
    1800
}

impl Default for TrayConfig {
    fn default() -> Self {
        Self {
            gateway_port: default_gateway_port(),
            tls_mode: default_tls_mode(),
            tls_cert: None,
            tls_key: None,
            tls_port: default_tls_port(),
            require_auth: default_require_auth(),
            audit_level: default_audit_level(),
            idle_timeout: default_idle_timeout(),
        }
    }
}

impl TrayConfig {
    /// Path to the config file: `~/.terminar/tray-config.json`
    pub fn config_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join(".terminar")
            .join("tray-config.json")
    }

    /// Load config from disk, returning defaults if the file doesn't exist or is invalid.
    pub fn load() -> Self {
        let path = Self::config_path();
        match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Load config from a specific path (for testing).
    pub fn load_from(path: &std::path::Path) -> Self {
        match fs::read_to_string(path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Save config to disk.
    pub fn save(&self) -> Result<(), String> {
        self.save_to(&Self::config_path())
    }

    /// Save config to a specific path (for testing).
    pub fn save_to(&self, path: &std::path::Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
        }
        let json =
            serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {e}"))?;
        fs::write(path, json).map_err(|e| format!("Failed to write config: {e}"))
    }

    /// Convert to gateway CLI arguments.
    pub fn to_gateway_args(&self) -> Vec<String> {
        let mut args = vec!["--port".to_string(), self.gateway_port.to_string()];

        match self.tls_mode {
            TlsMode::Off => {
                args.push("--no-auto-tls".to_string());
            }
            TlsMode::Auto => {
                // auto-tls is the default, no flag needed
                args.push("--tls-port".to_string());
                args.push(self.tls_port.to_string());
            }
            TlsMode::Custom => {
                if let Some(ref cert) = self.tls_cert {
                    args.push("--tls-cert".to_string());
                    args.push(cert.clone());
                }
                if let Some(ref key) = self.tls_key {
                    args.push("--tls-key".to_string());
                    args.push(key.clone());
                }
                args.push("--tls-port".to_string());
                args.push(self.tls_port.to_string());
            }
        }

        args.push("--idle-timeout".to_string());
        args.push(self.idle_timeout.to_string());

        args.push("--audit-level".to_string());
        args.push(self.audit_level.clone());

        args
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_default_config() {
        let config = TrayConfig::default();
        assert_eq!(config.gateway_port, 3000);
        assert_eq!(config.tls_mode, TlsMode::Auto);
        assert!(config.tls_cert.is_none());
        assert!(config.tls_key.is_none());
        assert_eq!(config.tls_port, 8444);
        assert!(config.require_auth);
        assert_eq!(config.audit_level, "standard");
        assert_eq!(config.idle_timeout, 1800);
    }

    #[test]
    fn test_load_save_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");

        let config = TrayConfig {
            gateway_port: 8080,
            tls_mode: TlsMode::Custom,
            tls_cert: Some("/path/to/cert.pem".to_string()),
            tls_key: Some("/path/to/key.pem".to_string()),
            tls_port: 9443,
            require_auth: false,
            audit_level: "verbose".to_string(),
            idle_timeout: 3600,
        };

        config.save_to(&path).unwrap();
        let loaded = TrayConfig::load_from(&path);
        assert_eq!(config, loaded);
    }

    #[test]
    fn test_missing_file_returns_defaults() {
        let config = TrayConfig::load_from(Path::new("/nonexistent/path/config.json"));
        assert_eq!(config, TrayConfig::default());
    }

    #[test]
    fn test_to_gateway_args_auto_tls() {
        let config = TrayConfig::default();
        let args = config.to_gateway_args();
        assert!(args.contains(&"--port".to_string()));
        assert!(args.contains(&"3000".to_string()));
        assert!(args.contains(&"--tls-port".to_string()));
        assert!(args.contains(&"8444".to_string()));
        assert!(!args.contains(&"--no-auto-tls".to_string()));
    }

    #[test]
    fn test_to_gateway_args_off_tls() {
        let config = TrayConfig {
            tls_mode: TlsMode::Off,
            ..Default::default()
        };
        let args = config.to_gateway_args();
        assert!(args.contains(&"--no-auto-tls".to_string()));
        assert!(!args.contains(&"--tls-port".to_string()));
    }

    #[test]
    fn test_to_gateway_args_custom_tls() {
        let config = TrayConfig {
            tls_mode: TlsMode::Custom,
            tls_cert: Some("/etc/certs/cert.pem".to_string()),
            tls_key: Some("/etc/certs/key.pem".to_string()),
            tls_port: 9443,
            ..Default::default()
        };
        let args = config.to_gateway_args();
        assert!(args.contains(&"--tls-cert".to_string()));
        assert!(args.contains(&"/etc/certs/cert.pem".to_string()));
        assert!(args.contains(&"--tls-key".to_string()));
        assert!(args.contains(&"/etc/certs/key.pem".to_string()));
        assert!(args.contains(&"--tls-port".to_string()));
        assert!(args.contains(&"9443".to_string()));
    }

    #[test]
    fn test_serde_roundtrip() {
        let config = TrayConfig {
            gateway_port: 4000,
            tls_mode: TlsMode::Off,
            tls_cert: None,
            tls_key: None,
            tls_port: 8444,
            require_auth: false,
            audit_level: "auth".to_string(),
            idle_timeout: 900,
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: TrayConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }
}
