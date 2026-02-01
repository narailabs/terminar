import { globalShortcut } from 'electron';

/**
 * Default shortcut accelerators for cross-platform compatibility.
 */
const DEFAULT_SHORTCUTS = {
  showHide: 'CommandOrControl+Shift+T',
  newSession: 'CommandOrControl+Shift+N',
};

/**
 * Interface for shortcut action callbacks.
 */
export interface ShortcutActions {
  showHide: () => void;
  newSession: () => void;
}

/**
 * Interface for config store get method.
 */
export interface ShortcutConfigProvider {
  get(key: 'shortcuts'): { showHide?: string; newSession?: string };
}

/**
 * ShortcutManager handles global keyboard shortcut registration using Electron's globalShortcut module.
 * Supports registering, unregistering, and reloading shortcuts from configuration.
 */
export class ShortcutManager {
  private registeredShortcuts: Set<string> = new Set();

  /**
   * Registers a global keyboard shortcut.
   * @param accelerator - The keyboard accelerator string (e.g., 'CommandOrControl+Shift+T').
   * @param callback - The function to call when the shortcut is triggered.
   * @returns true if registration succeeded, false otherwise.
   */
  register(accelerator: string, callback: () => void): boolean {
    try {
      const success = globalShortcut.register(accelerator, callback);
      if (success) {
        this.registeredShortcuts.add(accelerator);
      }
      return success;
    } catch {
      // Registration failed - shortcut may be in use by another application
      return false;
    }
  }

  /**
   * Unregisters a global keyboard shortcut.
   * @param accelerator - The keyboard accelerator string to unregister.
   */
  unregister(accelerator: string): void {
    globalShortcut.unregister(accelerator);
    this.registeredShortcuts.delete(accelerator);
  }

  /**
   * Unregisters all global keyboard shortcuts.
   */
  unregisterAll(): void {
    globalShortcut.unregisterAll();
    this.registeredShortcuts.clear();
  }

  /**
   * Reloads shortcuts from configuration.
   * Unregisters all existing shortcuts and re-registers from config.
   * @param config - The configuration provider with shortcuts settings.
   * @param actions - The action callbacks to bind to shortcuts.
   */
  reloadFromConfig(config: ShortcutConfigProvider, actions: ShortcutActions): void {
    this.unregisterAll();

    const shortcuts = config.get('shortcuts');
    const showHideAccelerator = shortcuts.showHide || DEFAULT_SHORTCUTS.showHide;
    const newSessionAccelerator = shortcuts.newSession || DEFAULT_SHORTCUTS.newSession;

    this.register(showHideAccelerator, actions.showHide);
    this.register(newSessionAccelerator, actions.newSession);
  }

  /**
   * Gets the list of currently registered shortcuts.
   * @returns Array of accelerator strings.
   */
  getRegisteredShortcuts(): string[] {
    return Array.from(this.registeredShortcuts);
  }
}
