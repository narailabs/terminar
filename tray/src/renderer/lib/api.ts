export interface TrayConfig {
  gateway_port: number;
  tls_mode: string;
  tls_cert: string | null;
  tls_key: string | null;
  tls_port: number;
  require_auth: boolean;
  audit_level: string;
  idle_timeout: number;
}

interface TrayAPI {
  getConfig(): Promise<TrayConfig>;
  saveConfig(config: TrayConfig): Promise<void>;
  getServiceStatus(): Promise<string>;
  getHealth(): Promise<any>;
  installService(config: TrayConfig): Promise<void>;
  uninstallService(): Promise<void>;
  restartService(): Promise<void>;
  stopService(): Promise<void>;
  startService(): Promise<void>;
  pickFile(options: { title: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  confirm(message: string, options: { title: string; kind: string }): Promise<boolean>;
  ask(message: string, options: { title: string; kind: string }): Promise<boolean>;
  closeWindow(): Promise<void>;
}

declare global {
  interface Window {
    trayAPI: TrayAPI;
  }
}

export const api = window.trayAPI;
