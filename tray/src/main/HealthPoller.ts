// HealthPoller.ts — Port of tray/src-tauri/src/health.rs
// Polls the server /health endpoint every 5 seconds and invokes a callback.

import * as fs from 'fs';
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

  /**
   * Start polling server liveness via the PID file instead of HTTP. The
   * server is Unix-socket-only (no `/health` endpoint to ask), so we check
   * the process is alive. Mirrors `isProcessAlive()`/`readPid()` in
   * npm/terminar/lib/server-manager.js. `version` is always null in this
   * mode since there is no HTTP endpoint to report it.
   */
  startPidLiveness(pidFilePath: string): void {
    this.stop();
    this.pollPidOnce(pidFilePath);
    this.interval = setInterval(() => {
      this.pollPidOnce(pidFilePath);
    }, 5000);
  }

  private pollPidOnce(pidFilePath: string): ServerHealth {
    const health = isPidFileAlive(pidFilePath)
      ? { status: 'running' as const, version: null }
      : { ...DEFAULT_HEALTH };

    this._latestHealth = health;
    this.onHealthUpdate?.(health);
    return health;
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

/** Read a PID from `pidFilePath` and check it's alive. Mirrors
 *  readPid()/isProcessAlive() in npm/terminar/lib/server-manager.js. */
function isPidFileAlive(pidFilePath: string): boolean {
  let pid: number;
  try {
    const content = fs.readFileSync(pidFilePath, 'utf-8').trim();
    pid = parseInt(content, 10);
    if (isNaN(pid)) return false;
  } catch {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
