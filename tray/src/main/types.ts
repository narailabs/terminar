// types.ts — TypeScript types for the Electron tray app main process.

// TrayConfig is shared between main and renderer — import from shared location
export type { TrayConfig } from '../shared/types.js';

export const DEFAULT_CONFIG: TrayConfig = {
  shell: null,
  log_level: 'info',
};

export type ServerStatus = 'running' | 'stopped';

export interface MenuSpec {
  status_text: string;
  is_running: boolean;
}

import type { TrayConfig } from '../shared/types.js';
