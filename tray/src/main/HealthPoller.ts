// HealthPoller.ts — Port of tray/src-tauri/src/health.rs
// Polls the server /health endpoint every 5 seconds and invokes a callback.

import { DEFAULT_HEALTH } from './types.js';
import type { ServerHealth } from './types.js';

/** Response shape from the server's /health endpoint. */
interface HealthEndpointResponse {
  status: string;
  version: string;
}

export class HealthPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private _latestHealth: ServerHealth = { ...DEFAULT_HEALTH };
  private onHealthUpdate: ((health: ServerHealth) => void) | null = null;

  /** The most recent health snapshot. */
  get latestHealth(): ServerHealth {
    return this._latestHealth;
  }

  /** Set the callback invoked on every health poll. */
  setCallback(callback: (health: ServerHealth) => void): void {
    this.onHealthUpdate = callback;
  }

  /**
   * Start polling the server health endpoint every 5 seconds.
   * Invokes the callback with a ServerHealth payload on every poll.
   */
  start(port: number): void {
    this.stop();
    // Poll immediately, then every 5 seconds
    void this.pollOnce(port);
    this.interval = setInterval(() => {
      void this.pollOnce(port);
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
   * Poll the server /health endpoint once.
   *
   * Branching logic:
   *   200 + valid JSON  -> Running (with version)
   *   200 + bad JSON    -> Running (null version)
   *   non-200           -> Starting
   *   timeout           -> Starting
   *   connection error  -> Stopped
   */
  async pollOnce(port: number): Promise<ServerHealth> {
    const url = `http://127.0.0.1:${port}/health`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    let health: ServerHealth;

    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        try {
          const data = (await resp.json()) as HealthEndpointResponse;
          health = {
            status: 'running',
            version: data.version,
          };
        } catch {
          // 200 but non-JSON (old version)
          health = {
            status: 'running',
            version: null,
          };
        }
      } else {
        // non-200 status code
        health = {
          status: 'starting',
          version: null,
        };
      }
    } catch (e: unknown) {
      clearTimeout(timeoutId);

      // AbortError means timeout
      if (e instanceof DOMException && e.name === 'AbortError') {
        health = {
          status: 'starting',
          version: null,
        };
      } else {
        // Connection refused / other error -> Stopped
        health = { ...DEFAULT_HEALTH };
      }
    }

    this._latestHealth = health;
    this.onHealthUpdate?.(health);
    return health;
  }
}
