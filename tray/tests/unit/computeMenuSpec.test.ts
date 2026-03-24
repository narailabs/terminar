import { describe, it, expect } from 'vitest';
import { computeMenuSpec } from '../../src/main/menuSpec.js';
import { DEFAULT_CONFIG, DEFAULT_HEALTH } from '../../src/main/types.js';
import type { TrayConfig, GatewayHealth } from '../../src/main/types.js';

describe('computeMenuSpec', () => {
  const defaultConfig: TrayConfig = { ...DEFAULT_CONFIG };

  it('shows "Not Installed" when service is not installed', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const spec = computeMenuSpec(health, 'notinstalled', defaultConfig);

    expect(spec.status_text).toContain('Not Installed');
    expect(spec.is_running).toBe(false);
    expect(spec.is_installed).toBe(false);
    expect(spec.service_actions).toBe('install');
    expect(spec.webui_enabled).toBe(false);
    expect(spec.servers_text).toBe('');
  });

  it('shows "Running" with active servers', () => {
    const health: GatewayHealth = {
      status: 'running',
      active_servers: 3,
      version: '1.0.0',
    };
    const spec = computeMenuSpec(health, 'running', defaultConfig);

    expect(spec.status_text).toContain('Running');
    expect(spec.status_text).toContain('\u25CF'); // filled circle
    expect(spec.is_running).toBe(true);
    expect(spec.is_installed).toBe(true);
    expect(spec.service_actions).toBe('running-actions');
    expect(spec.webui_enabled).toBe(true);
    expect(spec.servers_text).toBe('Active servers: 3');
  });

  it('shows "Stopped" when service is stopped', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const spec = computeMenuSpec(health, 'stopped', defaultConfig);

    expect(spec.status_text).toContain('Stopped');
    expect(spec.status_text).toContain('\u25CB'); // open circle
    expect(spec.is_running).toBe(false);
    expect(spec.is_installed).toBe(true);
    expect(spec.service_actions).toBe('stopped-actions');
    expect(spec.webui_enabled).toBe(false);
    expect(spec.servers_text).toBe('');
  });

  it('shows "Starting" status', () => {
    const health: GatewayHealth = {
      status: 'starting',
      active_servers: null,
      version: null,
    };
    const spec = computeMenuSpec(health, 'running', defaultConfig);

    expect(spec.status_text).toContain('Starting');
    expect(spec.status_text).toContain('\u25D4'); // half circle
    expect(spec.is_running).toBe(false);
    expect(spec.is_installed).toBe(true);
  });

  it('includes port in status text', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const config = { ...defaultConfig, gateway_port: 8080 };
    const spec = computeMenuSpec(health, 'stopped', config);

    expect(spec.status_text).toContain('port 8080');
  });

  it('includes TLS label when tls_mode is auto', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const config = { ...defaultConfig, tls_mode: 'auto' as const };
    const spec = computeMenuSpec(health, 'stopped', config);

    expect(spec.status_text).toContain(', TLS');
    expect(spec.tls_auto_checked).toBe(true);
  });

  it('includes TLS label when tls_mode is custom', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const config = { ...defaultConfig, tls_mode: 'custom' as const };
    const spec = computeMenuSpec(health, 'stopped', config);

    expect(spec.status_text).toContain(', TLS');
    expect(spec.tls_auto_checked).toBe(false);
  });

  it('no TLS label when tls_mode is off', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const config = { ...defaultConfig, tls_mode: 'off' as const };
    const spec = computeMenuSpec(health, 'stopped', config);

    expect(spec.status_text).not.toContain(', TLS');
    expect(spec.tls_auto_checked).toBe(false);
  });

  it('reflects auth_required_checked from config', () => {
    const health: GatewayHealth = { ...DEFAULT_HEALTH };
    const configAuth = { ...defaultConfig, require_auth: true };
    const configNoAuth = { ...defaultConfig, require_auth: false };

    expect(computeMenuSpec(health, 'stopped', configAuth).auth_required_checked).toBe(true);
    expect(computeMenuSpec(health, 'stopped', configNoAuth).auth_required_checked).toBe(false);
  });

  it('shows "Active servers: --" when running but count is null', () => {
    const health: GatewayHealth = {
      status: 'running',
      active_servers: null,
      version: null,
    };
    const spec = computeMenuSpec(health, 'running', defaultConfig);

    expect(spec.servers_text).toBe('Active servers: --');
  });
});
