import { Menu, MenuItemConstructorOptions } from 'electron';

/**
 * Manages the application's menu bar.
 * Provides methods to build and set the application menu with standard items.
 */
export class MenuManager {
  private menu: Electron.Menu | null = null;

  /**
   * Builds the application menu with File, Edit, View, and Help menus.
   * @returns The built Menu instance.
   */
  buildMenu(): Electron.Menu {
    const template: MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          {
            label: 'New Session',
            accelerator: 'CommandOrControl+N',
            click: () => {
              // Handler for new session
            },
          },
          {
            label: 'Connect',
            click: () => {
              // Handler for connect
            },
          },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: 'CommandOrControl+,',
            click: () => {
              // Handler for settings
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'copy' },
          { role: 'paste' },
          { type: 'separator' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'resetZoom' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About',
            click: () => {
              // Handler for about
            },
          },
        ],
      },
    ];

    this.menu = Menu.buildFromTemplate(template);
    return this.menu;
  }

  /**
   * Sets the built menu as the application menu.
   * If the menu hasn't been built yet, builds it first.
   */
  setApplicationMenu(): void {
    if (!this.menu) {
      this.buildMenu();
    }
    Menu.setApplicationMenu(this.menu);
  }

  /**
   * Gets the current menu instance.
   * @returns The current Menu or null if not built.
   */
  getMenu(): Electron.Menu | null {
    return this.menu;
  }
}
