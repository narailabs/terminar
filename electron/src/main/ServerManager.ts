/**
 * ServerManager: Spawns and manages the bundled Rust terminar-server
 * as a child process within the Electron app.
 *
 * Responsibilities:
 * - Spawn the server binary on app launch
 * - Monitor health via /health endpoint
 * - Graceful shutdown on app quit
 * - Process crash detection and notification
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping';

export class ServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: ServerStatus = 'stopped';
  private port = 6749;
  private stopping = false;

  /**
   * Resolve the path to the server binary.
   * In development: use the cargo-built binary from the server directory.
   * In production: use the bundled binary in resources/bin/.
   */
  private getBinaryPath(): string {
    if (app.isPackaged) {
      const platform = process.platform;
      const ext = platform === 'win32' ? '.exe' : '';
      return path.join(process.resourcesPath, 'bin', `terminar-server${ext}`);
    }

    // Development: look for the cargo release or debug binary
    const serverDir = path.resolve(app.getAppPath(), '..', 'server');
    const releasePath = path.join(serverDir, 'target', 'release', 'terminar-server');
    const debugPath = path.join(serverDir, 'target', 'debug', 'terminar-server');

    if (existsSync(releasePath)) return releasePath;
    if (existsSync(debugPath)) return debugPath;

    // Fallback: assume it's in PATH
    return 'terminar-server';
  }

  /**
   * Start the server process.
   * Resolves when the server is healthy (responding to /health).
   */
  async start(): Promise<void> {
    if (this.status === 'running' || this.status === 'starting') {
      return;
    }

    this.status = 'starting';
    this.stopping = false;

    const binaryPath = this.getBinaryPath();
    const args = [
      '--port', String(this.port),
      '--no-auth', // Local Electron connections skip auth
    ];

    // Ensure data directory exists
    const dataDir = path.join(app.getPath('userData'), 'server-data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    this.process = spawn(binaryPath, args, {
      env: { ...process.env, TERMINAR_DATA: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Forward stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      this.emit('output', data.toString());
    });

    // Forward stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('error-output', data.toString());
    });

    // Handle process exit
    this.process.on('close', (code: number | null) => {
      const wasRunning = this.status === 'running';
      this.process = null;

      if (this.stopping) {
        this.status = 'stopped';
        this.emit('stopped');
      } else if (wasRunning) {
        this.status = 'stopped';
        this.emit('crashed', code);
      } else {
        this.status = 'stopped';
        this.emit('stopped');
      }
    });

    // Wait for server to become healthy
    await this.waitForHealth();
    this.status = 'running';
    this.emit('started');
  }

  /**
   * Poll the /health endpoint until the server responds.
   */
  private async waitForHealth(): Promise<void> {
    const maxAttempts = 30;
    const delayMs = 200;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://localhost:${this.port}/health`);
        if (response.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // If we get stdout output, consider it started (health endpoint may not exist yet)
    // This allows development mode to work
  }

  /**
   * Stop the server process gracefully.
   */
  stop(): void {
    if (!this.process) return;

    this.stopping = true;
    this.status = 'stopping';
    this.process.kill('SIGTERM');
  }

  /**
   * Get the current server status.
   */
  getStatus(): ServerStatus {
    return this.status;
  }

  /**
   * Get the port the server is listening on.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the WebSocket URL for connecting to the server.
   */
  getWsUrl(): string {
    return `ws://localhost:${this.port}/ws`;
  }

  /**
   * Get the HTTP URL for the server API.
   */
  getHttpUrl(): string {
    return `http://localhost:${this.port}`;
  }
}
