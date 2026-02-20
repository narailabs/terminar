import type { TrayConfig } from '../../shared/types.js';
export type { TrayConfig };

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
