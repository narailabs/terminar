// ServiceManager.ts — Port of tray/src-tauri/src/service.rs
// Platform-specific service management for the terminar gateway.
//
// Generates shell scripts for privileged operations (install, uninstall,
// start, stop). The caller is responsible for executing these scripts with
// elevation.

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { TrayConfig, ServiceStatus } from './types.js';

export class ServiceManager {
  // ------------------------------------------------------------------
  // Service status
  // ------------------------------------------------------------------

  /** Check the current status of the gateway service. */
  status(): ServiceStatus {
    if (process.platform === 'darwin') {
      return this.statusMacos();
    }
    if (process.platform === 'linux') {
      return this.statusLinux();
    }
    return 'unknown';
  }

  private statusMacos(): ServiceStatus {
    try {
      const stdout = execFileSync('launchctl', [
        'print',
        'system/com.terminar.gateway',
      ], { encoding: 'utf-8' });

      if (stdout.includes('state = running')) {
        return 'running';
      }
      return 'stopped';
    } catch {
      // launchctl print may fail from certain process contexts.
      // Fall back to checking whether the plist file exists on disk.
      if (
        existsSync('/Library/LaunchDaemons/com.terminar.gateway.plist')
      ) {
        return 'stopped';
      }
      return 'notinstalled';
    }
  }

  private statusLinux(): ServiceStatus {
    try {
      const stdout = execFileSync('systemctl', [
        'is-active',
        'terminar-gateway',
      ], { encoding: 'utf-8' }).trim();

      switch (stdout) {
        case 'active':
          return 'running';
        case 'inactive':
        case 'failed':
          return 'stopped';
        default:
          // Check if service file exists
          if (
            existsSync('/etc/systemd/system/terminar-gateway.service')
          ) {
            return 'stopped';
          }
          return 'notinstalled';
      }
    } catch {
      return 'unknown';
    }
  }

  // ------------------------------------------------------------------
  // Binary discovery
  // ------------------------------------------------------------------

  /**
   * Find a binary by name, searching common locations.
   *
   * Search order:
   *  1. Same directory as the Electron app executable
   *  2. Workspace dev paths: server/target/{release,debug}/
   *  3. System PATH via `which`
   */
  findBinary(name: string): string | null {
    // 1. Bundled: same dir as current executable
    const exeDir = dirname(process.execPath);
    const bundled = join(exeDir, name);
    if (existsSync(bundled)) {
      return bundled;
    }

    // 2. Workspace dev paths — relative to cwd (repo root) or electron app path
    for (const base of [process.cwd()]) {
      for (const profile of ['release', 'debug']) {
        const candidate = join(base, 'server', 'target', profile, name);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }

    // 3. System PATH via `which`
    try {
      const result = execFileSync('which', [name], {
        encoding: 'utf-8',
      }).trim();
      if (result) {
        return result;
      }
    } catch {
      // not found in PATH
    }

    return null;
  }

  // ------------------------------------------------------------------
  // Script generators
  // ------------------------------------------------------------------

  /**
   * Generate the install script for the current platform.
   * Returns a shell script string that must be run with elevation.
   */
  installScript(
    config: TrayConfig,
    gatewayBin: string,
    serverBin: string,
  ): string {
    if (process.platform === 'darwin') {
      return this.installScriptMacos(config, gatewayBin, serverBin);
    }
    if (process.platform === 'linux') {
      return this.installScriptLinux(config, gatewayBin, serverBin);
    }
    return "echo 'Service installation not supported on this platform'";
  }

  private installScriptMacos(
    config: TrayConfig,
    gatewayBin: string,
    serverBin: string,
  ): string {
    const plist = this.generatePlist(config);

    return `#!/bin/bash
set -e

# --------------------------------------------------
# Pre-flight: verify source binaries exist
# --------------------------------------------------
if [ ! -f "${gatewayBin}" ]; then
    echo "Error: gateway binary not found at ${gatewayBin}" >&2
    exit 1
fi
if [ ! -f "${serverBin}" ]; then
    echo "Error: server binary not found at ${serverBin}" >&2
    exit 1
fi

# --------------------------------------------------
# Create service user (if not already exists)
# --------------------------------------------------
if ! id -u terminar >/dev/null 2>&1; then
    dscl . -create /Users/terminar
    dscl . -create /Users/terminar UserShell /usr/bin/false
    dscl . -create /Users/terminar UniqueID 499
    dscl . -create /Users/terminar PrimaryGroupID 20
    dscl . -create /Users/terminar NFSHomeDirectory /var/lib/terminar
    dscl . -create /Users/terminar RealName "terminar Service"
    dscl . -create /Users/terminar IsHidden 1
fi
if ! id -u terminar >/dev/null 2>&1; then
    echo "Error: failed to create 'terminar' service user" >&2
    exit 1
fi

# --------------------------------------------------
# Copy binaries to /usr/local/bin
# --------------------------------------------------
if [ "${gatewayBin}" != "/usr/local/bin/terminar-gateway" ]; then
    cp "${gatewayBin}" /usr/local/bin/terminar-gateway
fi
if [ "${serverBin}" != "/usr/local/bin/terminar-server" ]; then
    cp "${serverBin}" /usr/local/bin/terminar-server
fi
chmod 755 /usr/local/bin/terminar-gateway /usr/local/bin/terminar-server

# Re-sign binaries and strip quarantine so launchd won't reject them
codesign --force --sign - /usr/local/bin/terminar-gateway
codesign --force --sign - /usr/local/bin/terminar-server
xattr -dr com.apple.quarantine /usr/local/bin/terminar-gateway 2>/dev/null || true
xattr -dr com.apple.quarantine /usr/local/bin/terminar-server 2>/dev/null || true
xattr -dr com.apple.provenance /usr/local/bin/terminar-gateway 2>/dev/null || true
xattr -dr com.apple.provenance /usr/local/bin/terminar-server 2>/dev/null || true

if [ ! -x /usr/local/bin/terminar-gateway ]; then
    echo "Error: terminar-gateway not found at /usr/local/bin/ after copy" >&2
    exit 1
fi
if [ ! -x /usr/local/bin/terminar-server ]; then
    echo "Error: terminar-server not found at /usr/local/bin/ after copy" >&2
    exit 1
fi

# --------------------------------------------------
# Create runtime and data directories
# --------------------------------------------------
mkdir -p /var/run/terminar
chown terminar /var/run/terminar
mkdir -p /var/lib/terminar/.terminar/tls
chown -R terminar /var/lib/terminar

# --------------------------------------------------
# Create log file (terminar user can't write to /var/log/ directly)
# --------------------------------------------------
touch /var/log/terminar-gateway.log
chown terminar /var/log/terminar-gateway.log

# --------------------------------------------------
# Install sudoers rule
# --------------------------------------------------
mkdir -p /etc/sudoers.d
cat > /etc/sudoers.d/terminar << 'SUDOERS'
terminar ALL=(ALL) NOPASSWD: /usr/local/bin/terminar-server --user-mode --socket /var/run/terminar/*
SUDOERS
chmod 0440 /etc/sudoers.d/terminar

# --------------------------------------------------
# Write launchd plist
# --------------------------------------------------
cat > /Library/LaunchDaemons/com.terminar.gateway.plist << 'PLIST'
${plist}
PLIST
chown root:wheel /Library/LaunchDaemons/com.terminar.gateway.plist
if [ ! -f /Library/LaunchDaemons/com.terminar.gateway.plist ]; then
    echo "Error: failed to write service plist" >&2
    exit 1
fi

# --------------------------------------------------
# Register and start the service
# --------------------------------------------------
launchctl bootout system/com.terminar.gateway 2>/dev/null || true
launchctl bootstrap system /Library/LaunchDaemons/com.terminar.gateway.plist
echo "terminar gateway service installed and started"
`;
  }

  private installScriptLinux(
    config: TrayConfig,
    gatewayBin: string,
    serverBin: string,
  ): string {
    const unit = this.generateSystemdUnit(config);

    return `#!/bin/bash
set -e

# Create service user (ignore error if already exists)
useradd --system --create-home --shell /usr/sbin/nologin terminar 2>/dev/null || true

# Copy binaries
cp "${gatewayBin}" /usr/local/bin/terminar-gateway
cp "${serverBin}" /usr/local/bin/terminar-server
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
TERMINAR_GW_PORT=${config.gateway_port}
TERMINAR_GW_TLS_PORT=${config.tls_port}
TERMINAR_GW_LOG_LEVEL=info
TERMINAR_GW_AUDIT_LEVEL=${config.audit_level}
TERMINAR_GW_IDLE_TIMEOUT=${config.idle_timeout}
ENV

# Write systemd unit
cat > /etc/systemd/system/terminar-gateway.service << 'UNIT'
${unit}
UNIT

# Enable and start
systemctl daemon-reload
systemctl enable --now terminar-gateway
echo "terminar gateway service installed and started"
`;
  }

  /** Generate an uninstall script for the current platform. */
  uninstallScript(): string {
    if (process.platform === 'darwin') {
      return `#!/bin/bash
set -e
launchctl bootout system/com.terminar.gateway 2>/dev/null || true
rm -f /Library/LaunchDaemons/com.terminar.gateway.plist
rm -f /etc/sudoers.d/terminar
rm -f /var/log/terminar-gateway.log
echo "terminar gateway service uninstalled"
`;
    }
    if (process.platform === 'linux') {
      return `#!/bin/bash
set -e
systemctl stop terminar-gateway 2>/dev/null || true
systemctl disable terminar-gateway 2>/dev/null || true
rm -f /etc/systemd/system/terminar-gateway.service
rm -f /etc/sudoers.d/terminar
systemctl daemon-reload
echo "terminar gateway service uninstalled"
`;
    }
    return "echo 'Service uninstall not supported on this platform'";
  }

  /** Generate a restart script for the current platform. */
  restartScript(): string {
    if (process.platform === 'darwin') {
      return `#!/bin/bash
# If managed by launchd, use kickstart
if launchctl print system/com.terminar.gateway >/dev/null 2>&1; then
    launchctl kickstart -k system/com.terminar.gateway
else
    # Not managed by launchd — kill the process; user must restart manually
    pkill -f 'terminar-gateway' 2>/dev/null
    pkill -f 'terminar-server' 2>/dev/null
    true
fi
`;
    }
    if (process.platform === 'linux') {
      return `#!/bin/bash
# If managed by systemd, use systemctl
if systemctl is-active terminar-gateway >/dev/null 2>&1; then
    systemctl restart terminar-gateway
else
    # Not managed by systemd — kill the process; user must restart manually
    pkill -f 'terminar-gateway' 2>/dev/null
    pkill -f 'terminar-server' 2>/dev/null
    true
fi
`;
    }
    return "echo 'Service restart not supported on this platform'";
  }

  /** Generate a stop script for the current platform. */
  stopScript(): string {
    if (process.platform === 'darwin') {
      return `#!/bin/bash
# Try launchctl bootout first (for launchd-managed service)
launchctl bootout system/com.terminar.gateway 2>/dev/null

# If a terminar process is still running (gateway or standalone server),
# find and kill it. Handles both production (terminar-gateway) and
# dev mode (terminar-server --no-auth on the gateway port).
pkill -f 'terminar-gateway' 2>/dev/null
pkill -f 'terminar-server' 2>/dev/null
true
`;
    }
    if (process.platform === 'linux') {
      return `#!/bin/bash
# Try systemctl first (for systemd-managed service)
systemctl stop terminar-gateway 2>/dev/null

# If a terminar process is still running, kill it directly
pkill -f 'terminar-gateway' 2>/dev/null
pkill -f 'terminar-server' 2>/dev/null
true
`;
    }
    return "echo 'Service stop not supported on this platform'";
  }

  /** Generate a start script for the current platform. */
  startScript(): string {
    if (process.platform === 'darwin') {
      return `#!/bin/bash
set -e

PLIST=/Library/LaunchDaemons/com.terminar.gateway.plist
if [ ! -f "$PLIST" ]; then
    echo "Error: service plist not found at $PLIST — is the service installed?" >&2
    exit 1
fi

# Remove stale registration (ignore errors if not loaded)
launchctl bootout system/com.terminar.gateway 2>/dev/null || true

# Register and start the service
launchctl bootstrap system "$PLIST"
`;
    }
    if (process.platform === 'linux') {
      return `#!/bin/bash
systemctl start terminar-gateway
`;
    }
    return "echo 'Service start not supported on this platform'";
  }

  // ------------------------------------------------------------------
  // Service definition generators
  // ------------------------------------------------------------------

  /** Generate a macOS launchd plist for the gateway. */
  generatePlist(config: TrayConfig): string {
    const programArgs: string[] = [
      '        <string>/usr/local/bin/terminar-gateway</string>',
    ];

    switch (config.tls_mode) {
      case 'off':
        programArgs.push(
          '        <string>--no-auto-tls</string>',
        );
        break;
      case 'auto':
        // auto-tls is the default, no flag needed -- just set the port
        programArgs.push('        <string>--tls-port</string>');
        programArgs.push(
          `        <string>${config.tls_port}</string>`,
        );
        break;
      case 'custom':
        if (config.tls_cert) {
          programArgs.push(
            '        <string>--tls-cert</string>',
          );
          programArgs.push(
            `        <string>${config.tls_cert}</string>`,
          );
        }
        if (config.tls_key) {
          programArgs.push(
            '        <string>--tls-key</string>',
          );
          programArgs.push(
            `        <string>${config.tls_key}</string>`,
          );
        }
        programArgs.push('        <string>--tls-port</string>');
        programArgs.push(
          `        <string>${config.tls_port}</string>`,
        );
        break;
    }

    programArgs.push('        <string>--port</string>');
    programArgs.push(
      `        <string>${config.gateway_port}</string>`,
    );
    programArgs.push('        <string>--server-bin</string>');
    programArgs.push(
      '        <string>/usr/local/bin/terminar-server</string>',
    );
    programArgs.push('        <string>--socket-dir</string>');
    programArgs.push(
      '        <string>/var/run/terminar</string>',
    );
    programArgs.push('        <string>--idle-timeout</string>');
    programArgs.push(
      `        <string>${config.idle_timeout}</string>`,
    );
    programArgs.push('        <string>--audit-level</string>');
    programArgs.push(
      `        <string>${config.audit_level}</string>`,
    );

    const argsStr = programArgs.join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.terminar.gateway</string>

    <key>ProgramArguments</key>
    <array>
${argsStr}
    </array>

    <key>UserName</key>
    <string>terminar</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>/var/lib/terminar</string>
    </dict>

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
</plist>`;
  }

  /** Generate a Linux systemd unit file for the gateway. */
  generateSystemdUnit(config: TrayConfig): string {
    const execArgs: string[] = [
      '/usr/local/bin/terminar-gateway',
      '--port',
      `\${TERMINAR_GW_PORT:-${config.gateway_port}}`,
    ];

    switch (config.tls_mode) {
      case 'off':
        execArgs.push('--no-auto-tls');
        break;
      case 'auto':
        execArgs.push('--tls-port');
        execArgs.push(
          `\${TERMINAR_GW_TLS_PORT:-${config.tls_port}}`,
        );
        break;
      case 'custom':
        if (config.tls_cert) {
          execArgs.push('--tls-cert');
          execArgs.push(config.tls_cert);
        }
        if (config.tls_key) {
          execArgs.push('--tls-key');
          execArgs.push(config.tls_key);
        }
        execArgs.push('--tls-port');
        execArgs.push(
          `\${TERMINAR_GW_TLS_PORT:-${config.tls_port}}`,
        );
        break;
    }

    execArgs.push('--server-bin');
    execArgs.push('/usr/local/bin/terminar-server');
    execArgs.push('--socket-dir');
    execArgs.push('/run/terminar');
    execArgs.push('--idle-timeout');
    execArgs.push(
      `\${TERMINAR_GW_IDLE_TIMEOUT:-${config.idle_timeout}}`,
    );
    execArgs.push('--audit-level');
    execArgs.push(
      `\${TERMINAR_GW_AUDIT_LEVEL:-${config.audit_level}}`,
    );
    execArgs.push('--log-level');
    execArgs.push('${TERMINAR_GW_LOG_LEVEL:-info}');

    const execStart = execArgs.join(' \\\n    ');

    return `[Unit]
Description=terminar Gateway - Multi-user terminal session proxy
After=network.target
Wants=network.target

[Service]
Type=simple
User=terminar
Group=terminar

ExecStart=${execStart}

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
WantedBy=multi-user.target`;
  }
}
