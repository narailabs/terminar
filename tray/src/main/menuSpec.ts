// menuSpec.ts — Pure function to compute tray menu state.
// Extracted from TrayManager.ts so it can be unit tested without Electron.

import type {
  TrayConfig,
  GatewayHealth,
  ServiceStatus,
  ServiceActions,
  MenuSpec,
} from './types.js';

/**
 * Compute the menu specification from the current state.
 *
 * This is a pure function with no side effects, exported for unit testing.
 * Port of `compute_menu_spec` in tray.rs.
 */
export function computeMenuSpec(
  health: GatewayHealth,
  serviceStatus: ServiceStatus,
  config: TrayConfig,
  options?: { launchedByCli?: boolean; portOverride?: number },
): MenuSpec {
  const launchedByCli = options?.launchedByCli ?? false;
  const displayPort = options?.portOverride ?? config.gateway_port;

  // Status line
  let statusIcon = '\u25CB'; // open circle
  let statusLabel = 'Unknown';

  // In CLI mode, skip "Not Installed" — the CLI manages the server
  if (serviceStatus === 'notinstalled' && !launchedByCli) {
    statusIcon = '\u25CB'; // open circle
    statusLabel = 'Not Installed';
  } else {
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
  }

  const tlsLabel =
    !launchedByCli && (config.tls_mode === 'auto' || config.tls_mode === 'custom')
      ? ', TLS'
      : '';
  const serviceLabel = launchedByCli ? 'Server' : 'Gateway';
  const statusText = `${serviceLabel}: ${statusIcon} ${statusLabel} (port ${displayPort}${tlsLabel})`;

  // In CLI mode, the server is always considered "installed" (managed by CLI)
  const isInstalled = launchedByCli || serviceStatus !== 'notinstalled';
  const isRunning = isInstalled && health.status === 'running';

  let serversText = '';
  if (isRunning) {
    serversText =
      health.active_servers !== null
        ? `Active servers: ${health.active_servers}`
        : 'Active servers: --';
  }

  let serviceActions: ServiceActions;
  if (launchedByCli) {
    serviceActions = 'none';
  } else if (!isInstalled) {
    serviceActions = 'install';
  } else if (isRunning) {
    serviceActions = 'running-actions';
  } else {
    serviceActions = 'stopped-actions';
  }

  return {
    status_text: statusText,
    is_running: isRunning,
    is_installed: isInstalled,
    servers_text: serversText,
    webui_enabled: isRunning,
    tls_auto_checked: config.tls_mode === 'auto',
    auth_required_checked: config.require_auth,
    service_actions: serviceActions,
  };
}
