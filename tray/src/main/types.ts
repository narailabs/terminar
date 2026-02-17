// types.ts — Shared TypeScript types for the Electron tray app.
// Ported from config.rs, health.rs, service.rs, and tray.rs.

export interface TrayConfig {
  gateway_port: number;
  tls_mode: 'off' | 'auto' | 'custom';
  tls_cert: string | null;
  tls_key: string | null;
  tls_port: number;
  require_auth: boolean;
  audit_level: string;
  idle_timeout: number;
}

export const DEFAULT_CONFIG: TrayConfig = {
  gateway_port: 6749,
  tls_mode: 'auto',
  tls_cert: null,
  tls_key: null,
  tls_port: 8444,
  require_auth: true,
  audit_level: 'standard',
  idle_timeout: 1800,
};

export type GatewayStatus = 'running' | 'starting' | 'stopped';

export interface GatewayHealth {
  status: GatewayStatus;
  active_servers: number | null;
  version: string | null;
}

export const DEFAULT_HEALTH: GatewayHealth = {
  status: 'stopped',
  active_servers: null,
  version: null,
};

export type ServiceStatus = 'running' | 'stopped' | 'notinstalled' | 'unknown';

export type ServiceActions = 'install' | 'running-actions' | 'stopped-actions';

export interface MenuSpec {
  status_text: string;
  is_running: boolean;
  is_installed: boolean;
  servers_text: string;
  webui_enabled: boolean;
  tls_auto_checked: boolean;
  auth_required_checked: boolean;
  service_actions: ServiceActions;
}
