// menuSpec.ts — Pure function to compute tray menu state.
// Extracted from TrayManager.ts so it can be unit tested without Electron.

import type { ServerStatus, MenuSpec } from './types.js';

/**
 * Compute the menu specification from the current server status.
 *
 * This is a pure function with no side effects, exported for unit testing.
 */
export function computeMenuSpec(serverStatus: ServerStatus): MenuSpec {
  let statusIcon: string;
  let statusLabel: string;

  switch (serverStatus) {
    case 'running':
      statusIcon = '\u25CF'; // filled circle
      statusLabel = 'Running';
      break;
    case 'stopped':
      statusIcon = '\u25CB'; // open circle
      statusLabel = 'Stopped';
      break;
  }

  const statusText = `Server: ${statusIcon} ${statusLabel}`;

  return {
    status_text: statusText,
    is_running: serverStatus === 'running',
  };
}
