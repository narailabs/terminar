// MultiWindowCoordinator.ts — Tracks which Electron BrowserWindow shows which workspace tab.
// Each terminal window displays a single tab from the shared workspace.
// Each window holds its own Unix-socket connection to the server, bridged through
// the main process (see SocketBridge.ts) — this class only tracks tab assignment
// and relays workspace-mutation broadcasts between windows, it is not a transport.

import { BrowserWindow, ipcMain } from 'electron';

interface WindowTabMapping {
  windowId: number;
  tabId: string;
}

export class MultiWindowCoordinator {
  private mappings: WindowTabMapping[] = [];
  private windows: Map<number, BrowserWindow> = new Map();

  /** Register a window as showing a specific tab. Cleans up on window close. */
  register(win: BrowserWindow, tabId: string): void {
    if (this.windows.has(win.id)) return;
    this.windows.set(win.id, win);
    this.mappings.push({ windowId: win.id, tabId });
    win.on('closed', () => {
      this.windows.delete(win.id);
      this.mappings = this.mappings.filter((m) => m.windowId !== win.id);
    });
  }

  /** Get the tab ID assigned to a given window. */
  getTabForWindow(windowId: number): string | undefined {
    return this.mappings.find((m) => m.windowId === windowId)?.tabId;
  }

  /** Find the first tab from allTabIds that is not currently shown in any window. */
  getNextAvailableTab(allTabIds: string[]): string | null {
    const shownTabs = new Set(this.mappings.map((m) => m.tabId));
    return allTabIds.find((id) => !shownTabs.has(id)) ?? null;
  }

  /** Number of tracked windows. */
  get windowCount(): number {
    return this.windows.size;
  }

  /** Send a message to all windows except the source. */
  broadcastToOthers(sourceWindowId: number, channel: string, ...args: unknown[]): void {
    for (const [id, win] of this.windows) {
      if (id !== sourceWindowId && !win.isDestroyed()) {
        win.webContents.send(channel, ...args);
      }
    }
  }

  /** Register IPC handlers for multi-window coordination. */
  setupIpc(): void {
    ipcMain.handle('multi-window:get-tab', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return win ? this.getTabForWindow(win.id) : null;
    });

    ipcMain.on('multi-window:workspace-mutation', (event, mutation) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        this.broadcastToOthers(win.id, 'multi-window:workspace-updated', mutation);
      }
    });
  }
}
