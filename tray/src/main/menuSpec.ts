// menuSpec.ts — Pure function to compute tray menu state.
// Extracted from TrayManager.ts so it can be unit tested without Electron.

import type {
  ServerHealth,
  MenuSpec,
} from './types.js';

/**
 * Compute the menu specification from the current state.
 *
 * This is a pure function with no side effects, exported for unit testing.
 */
export function computeMenuSpec(
  health: ServerHealth,
  port: number,
): MenuSpec {
  // Status line
  let statusIcon = '\u25CB'; // open circle
  let statusLabel = 'Unknown';

  switch (health.status) {
    case 'running':
      statusIcon = '\u25CF'; // filled circle
      statusLabel = 'Running';
      break;
    case 'starting':
      statusIcon = '\u25D4'; // half circle
      statusLabel = 'Starting';
      break;
    case 'stopped':
      statusIcon = '\u25CB'; // open circle
      statusLabel = 'Stopped';
      break;
  }

  const statusText = `Server: ${statusIcon} ${statusLabel} (port ${port})`;
  const isRunning = health.status === 'running';

  return {
    status_text: statusText,
    is_running: isRunning,
  };
}
