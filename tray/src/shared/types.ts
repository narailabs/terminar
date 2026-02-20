// Shared types used by both main and renderer processes.

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
