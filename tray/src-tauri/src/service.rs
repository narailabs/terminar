use crate::config::{TlsMode, TrayConfig};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Current status of the gateway system service.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceStatus {
    Running,
    Stopped,
    NotInstalled,
    Unknown,
}

/// Platform-specific service management for the termiNar gateway.
///
/// The service manager generates shell scripts for privileged operations
/// (install, uninstall, start, stop) rather than running them directly.
/// The caller is responsible for executing these scripts with elevation.
pub struct ServiceManager;

impl ServiceManager {
    /// Check the current status of the gateway service.
    pub fn status() -> ServiceStatus {
        #[cfg(target_os = "macos")]
        {
            Self::status_macos()
        }
        #[cfg(target_os = "linux")]
        {
            Self::status_linux()
        }
        #[cfg(target_os = "windows")]
        {
            Self::status_windows()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            ServiceStatus::Unknown
        }
    }

    #[cfg(target_os = "macos")]
    fn status_macos() -> ServiceStatus {
        let output = Command::new("launchctl")
            .args(["print", "system/com.terminar.gateway"])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if stdout.contains("state = running") {
                    ServiceStatus::Running
                } else {
                    ServiceStatus::Stopped
                }
            }
            Ok(_) => ServiceStatus::NotInstalled,
            Err(_) => ServiceStatus::Unknown,
        }
    }

    #[cfg(target_os = "linux")]
    fn status_linux() -> ServiceStatus {
        let output = Command::new("systemctl")
            .args(["is-active", "terminar-gateway"])
            .output();

        match output {
            Ok(o) => {
                let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
                match stdout.as_str() {
                    "active" => ServiceStatus::Running,
                    "inactive" | "failed" => ServiceStatus::Stopped,
                    _ => {
                        // Check if service file exists
                        if Path::new("/etc/systemd/system/terminar-gateway.service").exists() {
                            ServiceStatus::Stopped
                        } else {
                            ServiceStatus::NotInstalled
                        }
                    }
                }
            }
            Err(_) => ServiceStatus::Unknown,
        }
    }

    #[cfg(target_os = "windows")]
    fn status_windows() -> ServiceStatus {
        let output = Command::new("sc.exe")
            .args(["query", "terminar-gateway"])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if stdout.contains("RUNNING") {
                    ServiceStatus::Running
                } else {
                    ServiceStatus::Stopped
                }
            }
            Ok(_) => ServiceStatus::NotInstalled,
            Err(_) => ServiceStatus::Unknown,
        }
    }

    /// Generate the install script for the current platform.
    ///
    /// Returns a shell script string that must be run with elevation.
    /// The script copies binaries, creates a service user, writes the
    /// service definition, and starts the service.
    pub fn install_script(
        config: &TrayConfig,
        gateway_bin: &Path,
        server_bin: &Path,
    ) -> String {
        #[cfg(target_os = "macos")]
        {
            Self::install_script_macos(config, gateway_bin, server_bin)
        }
        #[cfg(target_os = "linux")]
        {
            Self::install_script_linux(config, gateway_bin, server_bin)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            let _ = (config, gateway_bin, server_bin);
            "echo 'Service installation not supported on this platform'".to_string()
        }
    }

    #[cfg(target_os = "macos")]
    fn install_script_macos(
        config: &TrayConfig,
        gateway_bin: &Path,
        server_bin: &Path,
    ) -> String {
        let plist = Self::generate_plist(config);
        let gateway_bin = gateway_bin.display();
        let server_bin = server_bin.display();

        format!(
            r#"#!/bin/bash
set -e

# Create service user (ignore error if already exists)
sysadminctl -addUser terminar -shell /usr/bin/false -home /var/empty 2>/dev/null || true

# Copy binaries
cp "{gateway_bin}" /usr/local/bin/terminar-gateway
cp "{server_bin}" /usr/local/bin/terminar-server
chmod 755 /usr/local/bin/terminar-gateway /usr/local/bin/terminar-server

# Create socket directory
mkdir -p /var/run/terminar
chown terminar /var/run/terminar

# Install sudoers rule
cat > /etc/sudoers.d/terminar << 'SUDOERS'
terminar ALL=(ALL) NOPASSWD: /usr/local/bin/terminar-server --user-mode --socket /run/terminar/*
SUDOERS
chmod 0440 /etc/sudoers.d/terminar

# Write plist
cat > /Library/LaunchDaemons/com.terminar.gateway.plist << 'PLIST'
{plist}
PLIST
chown root:wheel /Library/LaunchDaemons/com.terminar.gateway.plist

# Load and start
launchctl load /Library/LaunchDaemons/com.terminar.gateway.plist
echo "termiNar gateway service installed and started"
"#
        )
    }

    #[cfg(target_os = "linux")]
    fn install_script_linux(
        config: &TrayConfig,
        gateway_bin: &Path,
        server_bin: &Path,
    ) -> String {
        let unit = Self::generate_systemd_unit(config);
        let gateway_bin = gateway_bin.display();
        let server_bin = server_bin.display();

        format!(
            r#"#!/bin/bash
set -e

# Create service user (ignore error if already exists)
useradd --system --create-home --shell /usr/sbin/nologin terminar 2>/dev/null || true

# Copy binaries
cp "{gateway_bin}" /usr/local/bin/terminar-gateway
cp "{server_bin}" /usr/local/bin/terminar-server
chmod 755 /usr/local/bin/terminar-gateway /usr/local/bin/terminar-server

# Create socket directory
mkdir -p /run/terminar
chown terminar:terminar /run/terminar

# Install sudoers rule
cat > /etc/sudoers.d/terminar << 'SUDOERS'
terminar ALL=(ALL) NOPASSWD: /usr/local/bin/terminar-server --user-mode --socket /run/terminar/*
SUDOERS
chmod 0440 /etc/sudoers.d/terminar

# Create environment file directory
mkdir -p /etc/terminar-gateway
cat > /etc/terminar-gateway/env << 'ENV'
TERMINAR_GW_PORT={port}
TERMINAR_GW_TLS_PORT={tls_port}
TERMINAR_GW_LOG_LEVEL=info
TERMINAR_GW_AUDIT_LEVEL={audit}
TERMINAR_GW_IDLE_TIMEOUT={idle}
ENV

# Write systemd unit
cat > /etc/systemd/system/terminar-gateway.service << 'UNIT'
{unit}
UNIT

# Enable and start
systemctl daemon-reload
systemctl enable --now terminar-gateway
echo "termiNar gateway service installed and started"
"#,
            port = config.gateway_port,
            tls_port = config.tls_port,
            audit = config.audit_level,
            idle = config.idle_timeout,
        )
    }

    /// Generate an uninstall script for the current platform.
    pub fn uninstall_script() -> String {
        #[cfg(target_os = "macos")]
        {
            r#"#!/bin/bash
set -e
launchctl unload /Library/LaunchDaemons/com.terminar.gateway.plist 2>/dev/null || true
rm -f /Library/LaunchDaemons/com.terminar.gateway.plist
rm -f /etc/sudoers.d/terminar
echo "termiNar gateway service uninstalled"
"#
            .to_string()
        }
        #[cfg(target_os = "linux")]
        {
            r#"#!/bin/bash
set -e
systemctl stop terminar-gateway 2>/dev/null || true
systemctl disable terminar-gateway 2>/dev/null || true
rm -f /etc/systemd/system/terminar-gateway.service
rm -f /etc/sudoers.d/terminar
systemctl daemon-reload
echo "termiNar gateway service uninstalled"
"#
            .to_string()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            "echo 'Service uninstall not supported on this platform'".to_string()
        }
    }

    /// Generate a restart script for the current platform.
    pub fn restart_script() -> String {
        #[cfg(target_os = "macos")]
        {
            r#"#!/bin/bash
launchctl kickstart -k system/com.terminar.gateway
"#
            .to_string()
        }
        #[cfg(target_os = "linux")]
        {
            r#"#!/bin/bash
systemctl restart terminar-gateway
"#
            .to_string()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            "echo 'Service restart not supported on this platform'".to_string()
        }
    }

    /// Generate a stop script for the current platform.
    pub fn stop_script() -> String {
        #[cfg(target_os = "macos")]
        {
            r#"#!/bin/bash
launchctl bootout system/com.terminar.gateway
"#
            .to_string()
        }
        #[cfg(target_os = "linux")]
        {
            r#"#!/bin/bash
systemctl stop terminar-gateway
"#
            .to_string()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            "echo 'Service stop not supported on this platform'".to_string()
        }
    }

    /// Generate a start script for the current platform.
    pub fn start_script() -> String {
        #[cfg(target_os = "macos")]
        {
            r#"#!/bin/bash
launchctl load /Library/LaunchDaemons/com.terminar.gateway.plist
"#
            .to_string()
        }
        #[cfg(target_os = "linux")]
        {
            r#"#!/bin/bash
systemctl start terminar-gateway
"#
            .to_string()
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            "echo 'Service start not supported on this platform'".to_string()
        }
    }

    /// Generate a macOS launchd plist for the gateway.
    pub fn generate_plist(config: &TrayConfig) -> String {
        let mut program_args = vec![
            "        <string>/usr/local/bin/terminar-gateway</string>".to_string(),
        ];

        match config.tls_mode {
            TlsMode::Off => {
                program_args.push("        <string>--no-auto-tls</string>".to_string());
            }
            TlsMode::Auto => {
                program_args.push("        <string>--auto-tls</string>".to_string());
                program_args
                    .push(format!("        <string>--tls-port</string>"));
                program_args.push(format!(
                    "        <string>{}</string>",
                    config.tls_port
                ));
            }
            TlsMode::Custom => {
                if let Some(ref cert) = config.tls_cert {
                    program_args.push("        <string>--tls-cert</string>".to_string());
                    program_args.push(format!("        <string>{cert}</string>"));
                }
                if let Some(ref key) = config.tls_key {
                    program_args.push("        <string>--tls-key</string>".to_string());
                    program_args.push(format!("        <string>{key}</string>"));
                }
                program_args
                    .push(format!("        <string>--tls-port</string>"));
                program_args.push(format!(
                    "        <string>{}</string>",
                    config.tls_port
                ));
            }
        }

        program_args.push("        <string>--port</string>".to_string());
        program_args.push(format!(
            "        <string>{}</string>",
            config.gateway_port
        ));
        program_args.push("        <string>--server-bin</string>".to_string());
        program_args
            .push("        <string>/usr/local/bin/terminar-server</string>".to_string());
        program_args.push("        <string>--socket-dir</string>".to_string());
        program_args.push("        <string>/var/run/terminar</string>".to_string());
        program_args.push("        <string>--idle-timeout</string>".to_string());
        program_args.push(format!(
            "        <string>{}</string>",
            config.idle_timeout
        ));
        program_args.push("        <string>--audit-level</string>".to_string());
        program_args.push(format!(
            "        <string>{}</string>",
            config.audit_level
        ));

        let args_str = program_args.join("\n");

        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.terminar.gateway</string>

    <key>ProgramArguments</key>
    <array>
{args_str}
    </array>

    <key>UserName</key>
    <string>terminar</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/var/log/terminar-gateway.log</string>

    <key>StandardErrorPath</key>
    <string>/var/log/terminar-gateway.log</string>

    <key>SoftResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>65536</integer>
    </dict>

    <key>HardResourceLimits</key>
    <dict>
        <key>NumberOfFiles</key>
        <integer>65536</integer>
    </dict>
</dict>
</plist>"#
        )
    }

    /// Generate a Linux systemd unit file for the gateway.
    pub fn generate_systemd_unit(config: &TrayConfig) -> String {
        let mut exec_args = vec![
            "/usr/local/bin/terminar-gateway".to_string(),
            "--port".to_string(),
            format!("${{TERMINAR_GW_PORT:-{}}}", config.gateway_port),
        ];

        match config.tls_mode {
            TlsMode::Off => {
                exec_args.push("--no-auto-tls".to_string());
            }
            TlsMode::Auto => {
                exec_args.push("--tls-port".to_string());
                exec_args.push(format!("${{TERMINAR_GW_TLS_PORT:-{}}}", config.tls_port));
            }
            TlsMode::Custom => {
                if let Some(ref cert) = config.tls_cert {
                    exec_args.push("--tls-cert".to_string());
                    exec_args.push(cert.clone());
                }
                if let Some(ref key) = config.tls_key {
                    exec_args.push("--tls-key".to_string());
                    exec_args.push(key.clone());
                }
                exec_args.push("--tls-port".to_string());
                exec_args.push(format!("${{TERMINAR_GW_TLS_PORT:-{}}}", config.tls_port));
            }
        }

        exec_args.push("--server-bin".to_string());
        exec_args.push("/usr/local/bin/terminar-server".to_string());
        exec_args.push("--socket-dir".to_string());
        exec_args.push("/run/terminar".to_string());
        exec_args.push("--idle-timeout".to_string());
        exec_args.push(format!(
            "${{TERMINAR_GW_IDLE_TIMEOUT:-{}}}",
            config.idle_timeout
        ));
        exec_args.push("--audit-level".to_string());
        exec_args.push(format!(
            "${{TERMINAR_GW_AUDIT_LEVEL:-{}}}",
            config.audit_level
        ));
        exec_args.push("--log-level".to_string());
        exec_args.push("${TERMINAR_GW_LOG_LEVEL:-info}".to_string());

        let exec_start = exec_args.join(" \\\n    ");

        format!(
            r#"[Unit]
Description=termiNar Gateway - Multi-user terminal session proxy
After=network.target
Wants=network.target

[Service]
Type=simple
User=terminar
Group=terminar

ExecStart={exec_start}

EnvironmentFile=-/etc/terminar-gateway/env

Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=60
StartLimitBurst=5

KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

ProtectSystem=strict
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictSUIDSGID=true

ReadWritePaths=/run/terminar
ReadWritePaths=/home

RuntimeDirectory=terminar
RuntimeDirectoryMode=0750

LimitNOFILE=65536
LimitNPROC=8192

StandardOutput=journal
StandardError=journal
SyslogIdentifier=terminar-gateway

[Install]
WantedBy=multi-user.target"#
        )
    }

    /// Find a binary by name, searching common locations.
    ///
    /// Search order:
    /// 1. Same directory as the tray binary (bundled distribution)
    /// 2. Workspace dev paths: `../server/target/release/`, `../server/target/debug/`
    /// 3. System PATH via `which`
    pub fn find_binary(name: &str) -> Option<PathBuf> {
        // 1. Bundled: same dir as current executable
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let candidate = dir.join(name);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }

        // 2. Workspace dev paths (relative to tray binary location)
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                for profile in &["release", "debug"] {
                    let candidate = dir
                        .join("..")
                        .join("..")
                        .join("..")
                        .join("server")
                        .join("target")
                        .join(profile)
                        .join(name);
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
        }

        // 3. System PATH
        let output = Command::new("which").arg(name).output().ok()?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_plist_auto_tls() {
        let config = TrayConfig {
            tls_mode: TlsMode::Auto,
            ..Default::default()
        };
        let plist = ServiceManager::generate_plist(&config);
        assert!(plist.contains("--auto-tls"));
        assert!(plist.contains("--tls-port"));
        assert!(plist.contains("8444"));
        assert!(plist.contains("com.terminar.gateway"));
        assert!(!plist.contains("--no-auto-tls"));
    }

    #[test]
    fn test_generate_plist_custom_tls() {
        let config = TrayConfig {
            tls_mode: TlsMode::Custom,
            tls_cert: Some("/etc/certs/cert.pem".to_string()),
            tls_key: Some("/etc/certs/key.pem".to_string()),
            tls_port: 9443,
            ..Default::default()
        };
        let plist = ServiceManager::generate_plist(&config);
        assert!(plist.contains("--tls-cert"));
        assert!(plist.contains("/etc/certs/cert.pem"));
        assert!(plist.contains("--tls-key"));
        assert!(plist.contains("/etc/certs/key.pem"));
        assert!(plist.contains("9443"));
    }

    #[test]
    fn test_generate_plist_off_tls() {
        let config = TrayConfig {
            tls_mode: TlsMode::Off,
            ..Default::default()
        };
        let plist = ServiceManager::generate_plist(&config);
        assert!(plist.contains("--no-auto-tls"));
        assert!(!plist.contains("--auto-tls"));
        assert!(!plist.contains("--tls-cert"));
    }

    #[test]
    fn test_generate_systemd_unit() {
        let config = TrayConfig::default();
        let unit = ServiceManager::generate_systemd_unit(&config);
        assert!(unit.contains("ExecStart="));
        assert!(unit.contains("/usr/local/bin/terminar-gateway"));
        assert!(unit.contains("User=terminar"));
        assert!(unit.contains("[Install]"));
        assert!(unit.contains("WantedBy=multi-user.target"));
    }

    #[test]
    fn test_install_script_macos() {
        let config = TrayConfig::default();
        let script = ServiceManager::install_script(
            &config,
            Path::new("/tmp/terminar-gateway"),
            Path::new("/tmp/terminar-server"),
        );
        assert!(script.contains("sysadminctl"));
        assert!(script.contains("cp"));
        assert!(script.contains("launchctl"));
        assert!(script.contains("/usr/local/bin/terminar-gateway"));
    }

    #[test]
    fn test_uninstall_script() {
        let script = ServiceManager::uninstall_script();
        assert!(script.contains("terminar"));
        // On macOS, should contain launchctl unload
        #[cfg(target_os = "macos")]
        assert!(script.contains("launchctl unload"));
    }

    #[test]
    fn test_generate_plist_contains_idle_timeout() {
        let config = TrayConfig {
            idle_timeout: 3600,
            ..Default::default()
        };
        let plist = ServiceManager::generate_plist(&config);
        assert!(plist.contains("--idle-timeout"));
        assert!(plist.contains("3600"));
    }

    #[test]
    fn test_generate_plist_contains_audit_level() {
        let config = TrayConfig {
            audit_level: "verbose".to_string(),
            ..Default::default()
        };
        let plist = ServiceManager::generate_plist(&config);
        assert!(plist.contains("--audit-level"));
        assert!(plist.contains("verbose"));
    }
}
