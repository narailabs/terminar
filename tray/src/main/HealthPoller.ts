// HealthPoller.ts — Polls the local server liveness by checking process state + socket existence.
// No more HTTP health endpoint polling.

import type { ServerStatus } from './types.js';
import type { ServerManager } from './ServerManager.js';

export class HealthPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private _latestStatus: ServerStatus = 'stopped';
  private onStatusUpdate: ((status: ServerStatus) => void) | null = null;
  private serverManager: ServerManager | null = null;

  /** The most recent server status. */
  get latestStatus(): ServerStatus {
    return this._latestStatus;
  }

  /** Set the ServerManager to poll. */
  setServerManager(serverManager: ServerManager): void {
    this.serverManager = serverManager;
  }

  /** Set the callback invoked on every poll. */
  setCallback(callback: (status: ServerStatus) => void): void {
    this.onStatusUpdate = callback;
  }

  /**
   * Start polling the server liveness every 5 seconds.
   */
  start(): void {
    this.stop();
    // Poll immediately, then every 5 seconds
    this.pollOnce();
    this.interval = setInterval(() => {
      this.pollOnce();
    }, 5000);
  }

  /** Stop the polling interval. */
  stop(): void {
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Poll the server liveness once.
   * Checks if the server process is running via the ServerManager.
   */
  pollOnce(): ServerStatus {
    const status: ServerStatus = this.serverManager?.isRunning() ? 'running' : 'stopped';
    this._latestStatus = status;
    this.onStatusUpdate?.(status);
    return status;
  }
}
