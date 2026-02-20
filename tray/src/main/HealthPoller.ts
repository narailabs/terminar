// HealthPoller.ts — Port of tray/src-tauri/src/health.rs
// Polls the gateway /health endpoint every 5 seconds and invokes a callback.

import { DEFAULT_HEALTH } from './types.js';
import type { GatewayHealth } from './types.js';

/** Response shape from the gateway's /health endpoint. */
interface HealthEndpointResponse {
  status: string;
  active_servers: number;
  version: string;
}

export class HealthPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private _latestHealth: GatewayHealth = { ...DEFAULT_HEALTH };
  private onHealthUpdate: ((health: GatewayHealth) => void) | null = null;

  /** The most recent health snapshot. */
  get latestHealth(): GatewayHealth {
    return this._latestHealth;
  }

  /** Set the callback invoked on every health poll. */
  setCallback(callback: (health: GatewayHealth) => void): void {
    this.onHealthUpdate = callback;
  }

  /**
   * Start polling the gateway health endpoint every 5 seconds.
   * Invokes the callback with a GatewayHealth payload on every poll.
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
   * Poll the gateway /health endpoint once.
   *
   * Branching logic (matching Rust):
   *   200 + valid JSON  -> Running (with active_servers, version)
   *   200 + bad JSON    -> Running (null, null)
   *   non-200           -> Starting
   *   timeout           -> Starting
   *   connection error  -> Stopped
   */
  async pollOnce(port: number): Promise<GatewayHealth> {
    const url = `http://127.0.0.1:${port}/health`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    let health: GatewayHealth;

    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (resp.ok) {
        try {
          const data = (await resp.json()) as HealthEndpointResponse;
          health = {
            status: 'running',
            active_servers: data.active_servers,
            version: data.version,
          };
        } catch {
          // 200 but non-JSON (old version)
          health = {
            status: 'running',
            active_servers: null,
            version: null,
          };
        }
      } else {
        // non-200 status code
        health = {
          status: 'starting',
          active_servers: null,
          version: null,
        };
      }
    } catch (e: unknown) {
      clearTimeout(timeoutId);

      // AbortError means timeout
      if (e instanceof DOMException && e.name === 'AbortError') {
        health = {
          status: 'starting',
          active_servers: null,
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
