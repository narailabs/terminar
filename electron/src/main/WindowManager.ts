import { BrowserWindow } from 'electron';

/**
 * Manages the application's main window lifecycle.
 * Provides methods to create, show, hide, and toggle the window visibility.
 */
export class WindowManager {
  private window: BrowserWindow | null = null;

  /**
   * Creates the main application window with secure defaults.
   * @returns The created BrowserWindow instance.
   */
  createMainWindow(): BrowserWindow {
    this.window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    return this.window;
  }

  /**
   * Shows the window and brings it to the front.
   */
  showWindow(): void {
    if (!this.window) {
      return;
    }
    this.window.show();
    this.window.focus();
  }

  /**
   * Hides the window.
   */
  hideWindow(): void {
    if (!this.window) {
      return;
    }
    this.window.hide();
  }

  /**
   * Toggles the window visibility.
   * If visible, hides the window. If hidden, shows and focuses it.
   */
  toggleWindow(): void {
    if (!this.window) {
      return;
    }
    if (this.window.isVisible()) {
      this.hideWindow();
    } else {
      this.showWindow();
    }
  }

  /**
   * Gets the current window instance.
   * @returns The current BrowserWindow or null if not created.
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }
}
