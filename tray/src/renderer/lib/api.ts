import type { TrayConfig } from '../../shared/types.js';
export type { TrayConfig };

interface TrayAPI {
  getConfig(): Promise<TrayConfig>;
  saveConfig(config: TrayConfig): Promise<void>;
  getHealth(): Promise<any>;
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
