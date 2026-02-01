import { Tray, Menu, MenuItemConstructorOptions } from 'electron';
import { EventEmitter } from 'events';

/**
 * Represents a shell session with its status.
 */
export interface TraySession {
  id: string;
  name: string;
  status: 'active' | 'idle';
}

/**
 * Server status for display in tray menu.
 */
export interface ServerInfo {
  status: 'running' | 'stopped' | 'starting';
  port?: number;
  remoteEnabled?: boolean;
  connectedClients?: number;
}

/**
 * Manages the system tray icon and menu.
 * Provides methods to create, update, and destroy the tray.
 */
export class TrayManager extends EventEmitter {
  private tray: Tray | null = null;
  private onToggleWindow: (() => void) | null = null;

  constructor() {
    super();
  }

  /**
   * Creates the system tray with an icon.
   * @param onToggleWindow - Optional callback for when tray is clicked.
   * @returns The created Tray instance.
   */
  create(onToggleWindow?: () => void): Tray {
    this.onToggleWindow = onToggleWindow ?? null;
    this.tray = new Tray('');

    // Register click handler to toggle window visibility
    this.tray.on('click', () => {
      if (this.onToggleWindow) {
        this.onToggleWindow();
      }
    });

    return this.tray;
  }

  /**
   * Updates the tray context menu with sessions and server info.
   * @param sessions - Array of sessions to display in the menu.
   * @param serverInfo - Optional server status information.
   */
  updateMenu(sessions: TraySession[], serverInfo?: ServerInfo): void {
    if (!this.tray) {
      return;
    }

    const template: MenuItemConstructorOptions[] = [];

    // Server status header
    if (serverInfo) {
      const statusIcon = serverInfo.status === 'running' ? '🟢' : serverInfo.status === 'starting' ? '🟡' : '🔴';
      template.push({
        label: `Server: ${statusIcon} ${serverInfo.status}${serverInfo.port ? ` (port ${serverInfo.port})` : ''}`,
        enabled: false,
      });
      template.push({ type: 'separator' });
    }

    // Add session items with status indicators
    for (const session of sessions) {
      const statusIndicator = session.status === 'active' ? '●' : '○';
      template.push({
        id: session.id,
        label: `${statusIndicator} ${session.name}`,
        click: () => {
          // Handler for session click
        },
      });
    }

    // Add separator after sessions if there are any
    if (sessions.length > 0) {
      template.push({ type: 'separator' });
    }

    // Add standard menu items
    template.push({
      label: 'New Session',
      click: () => {
        // Handler for new session
      },
    });

    template.push({
      label: 'Settings',
      click: () => {
        // Handler for settings
      },
    });

    template.push({
      label: 'Show/Hide',
      click: () => {
        if (this.onToggleWindow) {
          this.onToggleWindow();
        }
      },
    });

    // Remote Access submenu
    if (serverInfo) {
      template.push({ type: 'separator' });
      template.push({
        label: 'Remote Access',
        submenu: [
          {
            label: serverInfo.remoteEnabled ? 'Disable Remote Access' : 'Enable Remote Access',
            click: () => {
              this.emit('toggle-remote');
            },
          },
          ...(serverInfo.remoteEnabled && serverInfo.port ? [
            {
              label: `Port: ${serverInfo.port}`,
              enabled: false,
            } as MenuItemConstructorOptions,
            {
              label: `Connected: ${serverInfo.connectedClients ?? 0} clients`,
              enabled: false,
            } as MenuItemConstructorOptions,
            {
              label: 'Copy Connection URL',
              click: () => {
                this.emit('copy-connection-url');
              },
            } as MenuItemConstructorOptions,
          ] : []),
        ],
      });
    }

    template.push({ type: 'separator' });

    template.push({
      label: 'View Logs',
      click: () => {
        this.emit('view-logs');
      },
    });

    // Separator before Quit
    template.push({ type: 'separator' });

    template.push({
      label: 'Quit',
      role: 'quit',
    });

    const menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(menu);
  }

  /**
   * Destroys the system tray and cleans up resources.
   */
  destroy(): void {
    if (!this.tray) {
      return;
    }
    this.tray.destroy();
    this.tray = null;
  }

  /**
   * Gets the current tray instance.
   * @returns The current Tray or null if not created.
   */
  getTray(): Tray | null {
    return this.tray;
  }
}
