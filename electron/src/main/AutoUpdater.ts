import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import { EventEmitter } from 'events';

/**
 * Manages automatic updates via electron-updater.
 * Checks for updates on launch and emits events for UI notification.
 */
export class AutoUpdater extends EventEmitter {
  constructor() {
    super();

    // Configure auto-updater
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Forward events
    autoUpdater.on('update-available', (info) => {
      this.emit('update-available', info);
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.emit('update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
      this.emit('error', err);
    });

    autoUpdater.on('download-progress', (progress) => {
      this.emit('download-progress', progress);
    });
  }

  /**
   * Check for updates. Only runs in packaged builds.
   */
  async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) {
      return;
    }

    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      // Non-fatal: update check failure shouldn't crash the app
      this.emit('error', err);
    }
  }
}
