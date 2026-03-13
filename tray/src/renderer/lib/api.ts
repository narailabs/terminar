import type { TrayConfig } from '../../shared/types.js';
export type { TrayConfig };

export interface WslStatus {
  installed: boolean;
  hasDistro: boolean;
  distro: string | null;
}

interface TrayAPI {
  getConfig(): Promise<TrayConfig>;
  saveConfig(config: TrayConfig): Promise<void>;
  getServerStatus(): Promise<string>;
  startServer(): Promise<void>;
  stopServer(): Promise<void>;
  closeWindow(): Promise<void>;
  checkWsl(): Promise<WslStatus>;
}

declare global {
  interface Window {
    trayAPI: TrayAPI;
  }
}

export const api = window.trayAPI;
