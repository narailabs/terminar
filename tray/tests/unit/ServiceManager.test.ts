import { describe, it, expect } from 'vitest';
import { ServiceManager } from '../../src/main/ServiceManager.js';
import { DEFAULT_CONFIG } from '../../src/main/types.js';
import type { TrayConfig } from '../../src/main/types.js';

describe('ServiceManager', () => {
  const sm = new ServiceManager();

  describe('status()', () => {
    it('returns a valid service status', () => {
      const status = sm.status();
      expect(['running', 'stopped', 'notinstalled', 'unknown']).toContain(status);
    });
  });

  describe('findBinary()', () => {
    it('returns null for a non-existent binary', () => {
      const result = sm.findBinary('definitely-not-a-real-binary-xyz123');
      expect(result).toBeNull();
    });

    it('finds a binary on system PATH', () => {
      // 'bash' should be available on macOS/Linux
      const result = sm.findBinary('bash');
      expect(result).not.toBeNull();
      expect(result).toContain('bash');
    });

    it('returns absolute path for found binaries', () => {
      const result = sm.findBinary('bash');
      if (result) {
        expect(result.startsWith('/')).toBe(true);
      }
    });
  });

  describe('script generators', () => {
    const defaultConfig: TrayConfig = { ...DEFAULT_CONFIG };

    // ---- Install scripts ----

    it('generates install script with proper structure', () => {
      const script = sm.installScript(
        defaultConfig,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      expect(script).toContain('#!/bin/bash');
      expect(script).toContain('set -e');
      expect(script).toContain('terminar-gateway');
      expect(script).toContain('terminar-server');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl');
        expect(script).toContain('com.terminar.gateway');
        expect(script).toContain('codesign');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl');
        expect(script).toContain('systemd');
      }
    });

    it('install script includes TLS port when tls_mode is auto', () => {
      const config = { ...defaultConfig, tls_mode: 'auto' as const, tls_port: 9443 };
      const script = sm.installScript(
        config,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      expect(script).toContain('--tls-port');
      if (process.platform === 'darwin') {
        expect(script).toContain('9443');
      }
    });

    it('install script includes --no-auto-tls when tls_mode is off', () => {
      const config = { ...defaultConfig, tls_mode: 'off' as const };
      const script = sm.installScript(
        config,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      if (process.platform === 'darwin') {
        expect(script).toContain('--no-auto-tls');
      }
    });

    it('install script includes custom TLS cert/key paths', () => {
      const config = {
        ...defaultConfig,
        tls_mode: 'custom' as const,
        tls_cert: '/path/to/cert.pem',
        tls_key: '/path/to/key.pem',
      };
      const script = sm.installScript(
        config,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      if (process.platform === 'darwin') {
        expect(script).toContain('--tls-cert');
        expect(script).toContain('/path/to/cert.pem');
        expect(script).toContain('--tls-key');
        expect(script).toContain('/path/to/key.pem');
      }
    });

    it('install script includes idle-timeout and audit-level', () => {
      const config = { ...defaultConfig, idle_timeout: 3600, audit_level: 'verbose' };
      const script = sm.installScript(
        config,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      if (process.platform === 'darwin') {
        expect(script).toContain('--idle-timeout');
        expect(script).toContain('3600');
        expect(script).toContain('--audit-level');
        expect(script).toContain('verbose');
      }
    });

    it('install script creates service user', () => {
      const script = sm.installScript(
        defaultConfig,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      expect(script).toContain('terminar');
      if (process.platform === 'darwin') {
        expect(script).toContain('dscl');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('useradd');
      }
    });

    it('install script installs sudoers rule', () => {
      const script = sm.installScript(
        defaultConfig,
        '/usr/local/bin/terminar-gateway',
        '/usr/local/bin/terminar-server',
      );

      expect(script).toContain('/etc/sudoers.d/terminar');
      expect(script).toContain('NOPASSWD');
      expect(script).toContain('0440');
    });

    it('install script verifies binaries exist', () => {
      const script = sm.installScript(
        defaultConfig,
        '/path/to/gateway',
        '/path/to/server',
      );

      expect(script).toContain('/path/to/gateway');
      expect(script).toContain('/path/to/server');
      expect(script).toContain('not found');
    });

    // ---- Uninstall script ----

    it('generates uninstall script', () => {
      const script = sm.uninstallScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl bootout');
        expect(script).toContain('rm -f');
        expect(script).toContain('com.terminar.gateway.plist');
        expect(script).toContain('/etc/sudoers.d/terminar');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl stop');
        expect(script).toContain('systemctl disable');
        expect(script).toContain('daemon-reload');
      }
    });

    // ---- Start script ----

    it('generates start script', () => {
      const script = sm.startScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl bootstrap');
        expect(script).toContain('com.terminar.gateway.plist');
        // Should check if plist exists before trying to start
        expect(script).toContain('not found');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl start');
      }
    });

    it('start script on macOS removes stale registration before bootstrap', () => {
      if (process.platform !== 'darwin') return;

      const script = sm.startScript();
      expect(script).toContain('launchctl bootout');
      expect(script).toContain('2>/dev/null || true');
    });

    // ---- Stop script ----

    it('generates stop script', () => {
      const script = sm.stopScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl bootout');
        expect(script).toContain('system/com.terminar.gateway');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl stop');
      }
    });

    it('stop script kills both gateway and server processes', () => {
      const script = sm.stopScript();
      // Should kill both gateway (production) and server (dev mode) processes
      expect(script).toContain('pkill');
      expect(script).toContain('terminar-gateway');
      expect(script).toContain('terminar-server');
    });

    // ---- Restart script ----

    it('generates restart script', () => {
      const script = sm.restartScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl kickstart');
        expect(script).toContain('-k');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl restart');
      }
    });

    it('restart script falls back to pkill for non-managed processes', () => {
      const script = sm.restartScript();
      expect(script).toContain('pkill');
      expect(script).toContain('terminar-gateway');
      expect(script).toContain('terminar-server');
    });

    // ---- Unsupported platform fallback ----

    it('returns echo message for unsupported platform', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        expect(sm.installScript(defaultConfig, '/a', '/b')).toContain('not supported');
        expect(sm.uninstallScript()).toContain('not supported');
        expect(sm.startScript()).toContain('not supported');
        expect(sm.stopScript()).toContain('not supported');
        expect(sm.restartScript()).toContain('not supported');
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
      }
    });
  });

  describe('generatePlist()', () => {
    it('generates valid plist XML', () => {
      const config = { ...DEFAULT_CONFIG };
      const plist = sm.generatePlist(config);

      expect(plist).toContain('<?xml version="1.0"');
      expect(plist).toContain('<plist version="1.0">');
      expect(plist).toContain('com.terminar.gateway');
      expect(plist).toContain('/usr/local/bin/terminar-gateway');
      expect(plist).toContain('/usr/local/bin/terminar-server');
      expect(plist).toContain('<key>RunAtLoad</key>');
      expect(plist).toContain('<key>KeepAlive</key>');
      expect(plist).toContain('<string>terminar</string>');
    });

    it('includes audit-level and idle-timeout', () => {
      const config = { ...DEFAULT_CONFIG, audit_level: 'verbose', idle_timeout: 3600 };
      const plist = sm.generatePlist(config);

      expect(plist).toContain('--audit-level');
      expect(plist).toContain('verbose');
      expect(plist).toContain('--idle-timeout');
      expect(plist).toContain('3600');
    });

    it('includes socket-dir and server-bin paths', () => {
      const plist = sm.generatePlist(DEFAULT_CONFIG);

      expect(plist).toContain('--socket-dir');
      expect(plist).toContain('/var/run/terminar');
      expect(plist).toContain('--server-bin');
      expect(plist).toContain('/usr/local/bin/terminar-server');
    });

    it('includes port argument', () => {
      const config = { ...DEFAULT_CONFIG, gateway_port: 9999 };
      const plist = sm.generatePlist(config);

      expect(plist).toContain('--port');
      expect(plist).toContain('9999');
    });

    it('includes --no-auto-tls for tls_mode off', () => {
      const config = { ...DEFAULT_CONFIG, tls_mode: 'off' as const };
      const plist = sm.generatePlist(config);
      expect(plist).toContain('--no-auto-tls');
      expect(plist).not.toContain('--tls-port');
    });

    it('includes --tls-port for tls_mode auto', () => {
      const config = { ...DEFAULT_CONFIG, tls_mode: 'auto' as const, tls_port: 9443 };
      const plist = sm.generatePlist(config);
      expect(plist).toContain('--tls-port');
      expect(plist).toContain('9443');
    });

    it('includes custom cert/key paths for tls_mode custom', () => {
      const config = {
        ...DEFAULT_CONFIG,
        tls_mode: 'custom' as const,
        tls_cert: '/certs/server.pem',
        tls_key: '/certs/server.key',
      };
      const plist = sm.generatePlist(config);
      expect(plist).toContain('--tls-cert');
      expect(plist).toContain('/certs/server.pem');
      expect(plist).toContain('--tls-key');
      expect(plist).toContain('/certs/server.key');
    });

    it('includes resource limits', () => {
      const plist = sm.generatePlist(DEFAULT_CONFIG);
      expect(plist).toContain('NumberOfFiles');
      expect(plist).toContain('65536');
    });

    it('sets HOME environment variable', () => {
      const plist = sm.generatePlist(DEFAULT_CONFIG);
      expect(plist).toContain('<key>HOME</key>');
      expect(plist).toContain('/var/lib/terminar');
    });

    it('sets log paths', () => {
      const plist = sm.generatePlist(DEFAULT_CONFIG);
      expect(plist).toContain('StandardOutPath');
      expect(plist).toContain('StandardErrorPath');
      expect(plist).toContain('/var/log/terminar-gateway.log');
    });
  });

  describe('generateSystemdUnit()', () => {
    it('generates valid systemd unit', () => {
      const config = { ...DEFAULT_CONFIG };
      const unit = sm.generateSystemdUnit(config);

      expect(unit).toContain('[Unit]');
      expect(unit).toContain('[Service]');
      expect(unit).toContain('[Install]');
      expect(unit).toContain('User=terminar');
      expect(unit).toContain('terminar-gateway');
      expect(unit).toContain('WantedBy=multi-user.target');
      expect(unit).toContain('Restart=on-failure');
      expect(unit).toContain('ProtectSystem=strict');
    });

    it('includes security hardening directives', () => {
      const unit = sm.generateSystemdUnit(DEFAULT_CONFIG);
      expect(unit).toContain('PrivateTmp=true');
      expect(unit).toContain('ProtectKernelTunables=true');
      expect(unit).toContain('ProtectKernelModules=true');
      expect(unit).toContain('ProtectControlGroups=true');
      expect(unit).toContain('RestrictNamespaces=true');
      expect(unit).toContain('RestrictSUIDSGID=true');
    });

    it('includes resource limits', () => {
      const unit = sm.generateSystemdUnit(DEFAULT_CONFIG);
      expect(unit).toContain('LimitNOFILE=65536');
      expect(unit).toContain('LimitNPROC=8192');
    });

    it('includes environment file reference', () => {
      const unit = sm.generateSystemdUnit(DEFAULT_CONFIG);
      expect(unit).toContain('EnvironmentFile=-/etc/terminar-gateway/env');
    });

    it('includes --no-auto-tls for tls_mode off', () => {
      const config = { ...DEFAULT_CONFIG, tls_mode: 'off' as const };
      const unit = sm.generateSystemdUnit(config);
      expect(unit).toContain('--no-auto-tls');
    });

    it('includes --tls-port for tls_mode auto', () => {
      const config = { ...DEFAULT_CONFIG, tls_mode: 'auto' as const };
      const unit = sm.generateSystemdUnit(config);
      expect(unit).toContain('--tls-port');
    });

    it('includes custom cert/key for tls_mode custom', () => {
      const config = {
        ...DEFAULT_CONFIG,
        tls_mode: 'custom' as const,
        tls_cert: '/certs/server.pem',
        tls_key: '/certs/server.key',
      };
      const unit = sm.generateSystemdUnit(config);
      expect(unit).toContain('--tls-cert');
      expect(unit).toContain('/certs/server.pem');
      expect(unit).toContain('--tls-key');
      expect(unit).toContain('/certs/server.key');
    });

    it('includes socket-dir and server-bin paths', () => {
      const unit = sm.generateSystemdUnit(DEFAULT_CONFIG);
      expect(unit).toContain('--socket-dir');
      expect(unit).toContain('/run/terminar');
      expect(unit).toContain('--server-bin');
      expect(unit).toContain('/usr/local/bin/terminar-server');
    });

    it('includes kill and timeout settings', () => {
      const unit = sm.generateSystemdUnit(DEFAULT_CONFIG);
      expect(unit).toContain('KillMode=mixed');
      expect(unit).toContain('KillSignal=SIGTERM');
      expect(unit).toContain('TimeoutStopSec=30');
    });
  });
});
