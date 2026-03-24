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
import type { WindowManager } from './WindowManager.js';

// Re-export for backward compatibility
export { computeMenuSpec } from './menuSpec.js';

type MenuAction =
  | 'open-desktop-app'
  | 'settings'
  | 'quit';

export class TrayManager {
  private tray: Tray | null = null;
  private configStore: ConfigStore;
  private healthPoller: HealthPoller;
  private windowManager: WindowManager;
  private serverPort: number;

  constructor(
    configStore: ConfigStore,
    healthPoller: HealthPoller,
    windowManager: WindowManager,
    options?: { serverPort?: number },
  ) {
    this.configStore = configStore;
    this.healthPoller = healthPoller;
    this.windowManager = windowManager;
    this.serverPort = options?.serverPort ?? configStore.load().server_port;

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

    const spec = computeMenuSpec(health, this.serverPort);

    const menuTemplate: Electron.MenuItemConstructorOptions[] = [];

    // Status line (disabled -- informational only)
    menuTemplate.push({
      label: spec.status_text,
      enabled: false,
    });
    menuTemplate.push({ type: 'separator' });

    // Open Desktop App
    menuTemplate.push({
      label: 'Open terminar',
      enabled: spec.is_running,
      click: () => this.handleMenuEvent('open-desktop-app'),
    });

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
