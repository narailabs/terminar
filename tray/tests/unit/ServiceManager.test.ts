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
  });

  describe('script generators', () => {
    const defaultConfig: TrayConfig = { ...DEFAULT_CONFIG };

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

    it('generates uninstall script', () => {
      const script = sm.uninstallScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl bootout');
        expect(script).toContain('rm -f');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl stop');
        expect(script).toContain('systemctl disable');
      }
    });

    it('generates start script', () => {
      const script = sm.startScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl bootstrap');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl start');
      }
    });

    it('generates stop script', () => {
      const script = sm.stopScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl bootout');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl stop');
      }
    });

    it('generates restart script', () => {
      const script = sm.restartScript();
      expect(script).toContain('#!/bin/bash');

      if (process.platform === 'darwin') {
        expect(script).toContain('launchctl kickstart');
      }
      if (process.platform === 'linux') {
        expect(script).toContain('systemctl restart');
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
  });
});
