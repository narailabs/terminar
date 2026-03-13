// TrayManager.ts — Manages the system tray icon and its context menu.

import {
  Tray,
  Menu,
  nativeImage,
  app,
} from 'electron';
import path from 'path';
import { getAppRoot } from './paths.js';
import { computeMenuSpec } from './menuSpec.js';
import { HealthPoller } from './HealthPoller.js';
import { ServerManager } from './ServerManager.js';
import type { WindowManager } from './WindowManager.js';

// Re-export for backward compatibility
export { computeMenuSpec } from './menuSpec.js';

type MenuAction =
  | 'start-server'
  | 'stop-server'
  | 'settings'
  | 'quit';

export class TrayManager {
  private tray: Tray | null = null;
  private serverManager: ServerManager;
  private healthPoller: HealthPoller;
  private windowManager: WindowManager;

  constructor(
    serverManager: ServerManager,
    healthPoller: HealthPoller,
    windowManager: WindowManager,
  ) {
    this.serverManager = serverManager;
    this.healthPoller = healthPoller;
    this.windowManager = windowManager;

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

    const serverStatus = this.healthPoller.latestStatus;
    const spec = computeMenuSpec(serverStatus);

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    // Status line (disabled — informational only)
    menuTemplate.push({
      label: spec.status_text,
      enabled: false,
    });
    menuTemplate.push({ type: 'separator' });

    // Start/Stop server
    if (spec.is_running) {
      menuTemplate.push({
        label: 'Stop Server',
        click: () => this.handleMenuEvent('stop-server'),
      });
    } else {
      menuTemplate.push({
        label: 'Start Server',
        click: () => this.handleMenuEvent('start-server'),
      });
    }

    menuTemplate.push({ type: 'separator' });

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
   */
  private handleMenuEvent(id: MenuAction): void {
    console.log(`[tray] menu event: ${id}`);
    switch (id) {
      case 'start-server': {
        void this.serverManager.start().catch((e) => {
          console.error(`Failed to start server: ${e}`);
        });
        break;
      }

      case 'stop-server': {
        void this.serverManager.stop().catch((e) => {
          console.error(`Failed to stop server: ${e}`);
        });
        break;
      }

      case 'settings': {
        if (process.platform === 'darwin') app.dock?.show();
        this.windowManager.openSettings();
        break;
      }

      case 'quit': {
        void this.serverManager.stop().then(() => {
          app.quit();
        }).catch(() => {
          app.quit();
        });
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
