// types.ts — TypeScript types for the Electron tray app main process.

// TrayConfig is shared between main and renderer — import from shared location
import type { TrayConfig } from '../shared/types.js';
export type { TrayConfig };

export const DEFAULT_CONFIG: TrayConfig = {
  server_port: 6750,
};

export type ServerStatus = 'running' | 'starting' | 'stopped';

export interface ServerHealth {
  status: ServerStatus;
  version: string | null;
}

export const DEFAULT_HEALTH: ServerHealth = {
  status: 'stopped',
  version: null,
};

export interface MenuSpec {
  status_text: string;
  is_running: boolean;
}
