// TrayManager.ts — Port of tray/src-tauri/src/tray.rs + menu event handling from lib.rs
// Manages the system tray icon and its context menu.

import {
  Tray,
  Menu,
  nativeImage,
  app,
} from 'electron';
import path from 'path';
import { getAppRoot } from './paths.js';
import { computeMenuSpec } from './menuSpec.js';
import { ConfigStore } from './ConfigStore.js';
import { HealthPoller } from './HealthPoller.js';
import { ServiceManager } from './ServiceManager.js';
import { runElevated } from './elevation.js';
import type { WindowManager } from './WindowManager.js';

// Re-export for backward compatibility
export { computeMenuSpec } from './menuSpec.js';

type MenuAction =
  | 'open-desktop-app'
  | 'toggle-tls'
  | 'toggle-auth'
  | 'audit-off'
  | 'audit-auth'
  | 'audit-standard'
  | 'audit-verbose'
  | 'install-service'
  | 'start-service'
  | 'uninstall-service'
  | 'restart-service'
  | 'stop-service'
  | 'settings'
  | 'quit';

export class TrayManager {
  private tray: Tray | null = null;
  private configStore: ConfigStore;
  private serviceManager: ServiceManager;
  private healthPoller: HealthPoller;
  private windowManager: WindowManager;
  private launchedByCli: boolean;
  private serverPort: number | undefined;
  constructor(
    configStore: ConfigStore,
    serviceManager: ServiceManager,
    healthPoller: HealthPoller,
    windowManager: WindowManager,
    options?: { launchedByCli?: boolean; serverPort?: number },
  ) {
    this.configStore = configStore;
    this.serviceManager = serviceManager;
    this.healthPoller = healthPoller;
    this.windowManager = windowManager;
    this.launchedByCli = options?.launchedByCli ?? false;
    this.serverPort = options?.serverPort;

    this.createTray();
  }

  private createTray(): void {
    // getAppRoot() returns tray/ directory (where package.json lives), works in
    // both dev (`electron .`) and direct launch (`electron dist-electron/index.js`).
    const iconsDir = path.join(getAppRoot(), 'icons');

    let icon: Electron.NativeImage;
    if (process.platform === 'darwin') {
      // macOS: use template images for automatic dark/light mode
      const templatePath = path.join(iconsDir, 'iconTemplate.png');
      icon = nativeImage.createFromPath(templatePath);
      icon.setTemplateImage(true);
    } else {
      icon = nativeImage.createFromPath(path.join(iconsDir, 'icon.png'));
    }

    if (icon.isEmpty()) {
      console.error('Tray icon is empty! Tried:', iconsDir);
      // Fallback: create a simple 16x16 colored icon so the tray is at least visible
      icon = nativeImage.createFromBuffer(
        Buffer.alloc(16 * 16 * 4, 0xff),
        { width: 16, height: 16 },
      );
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('terminar');
    this.updateMenu();
  }

  /** Rebuild the tray context menu from current state. */
  updateMenu(): void {
    if (!this.tray) return;

    const health = this.healthPoller.latestHealth;
    const serviceStatus = this.serviceManager.status();
    const config = this.configStore.load();

    const spec = computeMenuSpec(health, serviceStatus, config, {
      launchedByCli: this.launchedByCli,
      portOverride: this.serverPort,
    });

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    // Status line (disabled — informational only)
    menuTemplate.push({
      label: spec.status_text,
      enabled: false,
    });
    menuTemplate.push({ type: 'separator' });

    // Active servers count (only when running)
    if (spec.is_running) {
      menuTemplate.push({
        label: spec.servers_text,
        enabled: false,
      });
      menuTemplate.push({ type: 'separator' });
    }

    // Open Desktop App
    menuTemplate.push({
      label: 'Open terminar',
      enabled: spec.webui_enabled,
      click: () => this.handleMenuEvent('open-desktop-app'),
    });

    // Security submenu and service actions — hidden in CLI mode
    if (!this.launchedByCli) {
      menuTemplate.push({ type: 'separator' });

      menuTemplate.push({
        label: 'Security',
        submenu: [
          {
            label: 'Auto-TLS',
            type: 'checkbox',
            checked: spec.tls_auto_checked,
            click: () => this.handleMenuEvent('toggle-tls'),
          },
          {
            label: 'Auth Required',
            type: 'checkbox',
            checked: spec.auth_required_checked,
            click: () => this.handleMenuEvent('toggle-auth'),
          },
          {
            label: 'Audit Level',
            submenu: [
              {
                label: 'Off',
                click: () => this.handleMenuEvent('audit-off'),
              },
              {
                label: 'Auth Only',
                click: () => this.handleMenuEvent('audit-auth'),
              },
              {
                label: 'Standard',
                click: () => this.handleMenuEvent('audit-standard'),
              },
              {
                label: 'Verbose',
                click: () => this.handleMenuEvent('audit-verbose'),
              },
            ],
          },
        ],
      });

      menuTemplate.push({ type: 'separator' });

      switch (spec.service_actions) {
        case 'install':
          menuTemplate.push({
            label: 'Install Gateway...',
            click: () => this.handleMenuEvent('install-service'),
          });
          break;
        case 'running-actions':
          menuTemplate.push({
            label: 'Restart Service',
            click: () => this.handleMenuEvent('restart-service'),
          });
          menuTemplate.push({
            label: 'Stop Service',
            click: () => this.handleMenuEvent('stop-service'),
          });
          break;
        case 'stopped-actions':
          menuTemplate.push({
            label: 'Start Service',
            click: () => this.handleMenuEvent('start-service'),
          });
          menuTemplate.push({
            label: 'Uninstall Gateway',
            click: () => this.handleMenuEvent('uninstall-service'),
          });
          break;
      }
    }

    // Settings
    menuTemplate.push({
      label: 'Settings...',
      click: () => this.handleMenuEvent('settings'),
    });

    menuTemplate.push({ type: 'separator' });

    // Quit
    menuTemplate.push({
      label: 'Quit',
      click: () => this.handleMenuEvent('quit'),
    });

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Handle tray menu item clicks.
   * Port of handle_menu_event() from lib.rs.
   */
  private handleMenuEvent(id: MenuAction): void {
    console.log(`[tray] menu event: ${id}`);
    switch (id) {
      case 'open-desktop-app': {
        this.windowManager.openTerminal();
        break;
      }

      case 'toggle-tls': {
        const config = this.configStore.load();
        config.tls_mode =
          config.tls_mode === 'auto' ? 'off' : 'auto';
        this.configStore.save(config);
        this.updateMenu();
        break;
      }

      case 'toggle-auth': {
        const config = this.configStore.load();
        config.require_auth = !config.require_auth;
        this.configStore.save(config);
        this.updateMenu();
        break;
      }

      case 'audit-off':
      case 'audit-auth':
      case 'audit-standard':
      case 'audit-verbose': {
        const config = this.configStore.load();
        config.audit_level = id.replace('audit-', '');
        this.configStore.save(config);
        this.updateMenu();
        break;
      }

      case 'install-service': {
        this.windowManager.openInstall();
        break;
      }

      case 'start-service': {
        const script = this.serviceManager.startScript();
        try {
          runElevated(script);
        } catch (e) {
          console.error(`Failed to start service: ${e}`);
        }
        break;
      }

      case 'uninstall-service': {
        const script = this.serviceManager.uninstallScript();
        try {
          runElevated(script);
        } catch (e) {
          console.error(`Failed to uninstall service: ${e}`);
        }
        break;
      }

      case 'restart-service': {
        const script = this.serviceManager.restartScript();
        try {
          runElevated(script);
        } catch (e) {
          console.error(`Failed to restart service: ${e}`);
        }
        break;
      }

      case 'stop-service': {
        const script = this.serviceManager.stopScript();
        try {
          runElevated(script);
        } catch (e) {
          console.error(`Failed to stop service: ${e}`);
        }
        break;
      }

      case 'settings': {
        this.windowManager.openSettings();
        break;
      }

      case 'quit': {
        app.quit();
        break;
      }

      default: {
        const _exhaustive: never = id;
        console.warn(`[tray] unhandled menu action: ${_exhaustive}`);
      }
    }
  }

  /** Destroy the tray icon. */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
