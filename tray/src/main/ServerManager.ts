// ServerManager.ts — Manages the local terminar-server as a child process.
// Replaces the old ServiceManager which managed gateway system services.

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { app } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import { getAppRoot } from './paths.js';
import { WslManager } from './WslManager.js';

export class ServerManager extends EventEmitter {
  private serverProcess: ChildProcess | null = null;
  private socketPath: string;

  constructor() {
    super();
    const home = process.env.HOME || process.env.USERPROFILE || '';
    this.socketPath = path.join(home, '.terminar', 'server.sock');
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getServerBinaryPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'terminar-server');
    }
    // Dev mode: search for cargo build output
    const bases = new Set([process.cwd(), path.dirname(getAppRoot())]);
    for (const base of bases) {
      for (const profile of ['release', 'debug']) {
        const candidate = path.join(base, 'server', 'target', profile, 'terminar-server');
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    // Fallback to relative path from tray/
    return path.join(getAppRoot(), '..', 'server', 'target', 'debug', 'terminar-server');
  }

  isRunning(): boolean {
    return this.serverProcess !== null && this.serverProcess.exitCode === null;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;

    if (WslManager.isWindows()) {
      await this.startViaWsl();
    } else {
      await this.startNative();
    }
  }

  private async startNative(): Promise<void> {
    const bin = this.getServerBinaryPath();
    this.serverProcess = spawn(bin, ['--socket', this.socketPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.attachProcessHandlers();
    await this.waitForSocket();
  }

  private async startViaWsl(): Promise<void> {
    const wslServerPath = '~/.terminar/terminar-server';

    if (!WslManager.isServerInstalled(wslServerPath)) {
      const bundledPath = this.getServerBinaryPath();
      await WslManager.installServerBinary(bundledPath, wslServerPath);
    }

    // Spawn via WSL with stdio mode — communication is via stdin/stdout
    this.serverProcess = WslManager.spawnServer(wslServerPath);
    this.attachProcessHandlers();
    this.emit('started');
  }

  private attachProcessHandlers(): void {
    if (!this.serverProcess) return;

    this.serverProcess.on('exit', (code) => {
      this.serverProcess = null;
      this.emit('exit', code);
    });

    this.serverProcess.stderr?.on('data', (data: Buffer) => {
      console.error('[server]', data.toString());
    });

    // Only log stdout in non-WSL mode; in WSL stdio mode, stdout carries protocol data
    if (!WslManager.isWindows()) {
      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        console.log('[server]', data.toString());
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.serverProcess) return;
    this.serverProcess.kill('SIGTERM');
    // Wait for process to exit
    await new Promise<void>((resolve) => {
      if (!this.serverProcess) { resolve(); return; }
      this.serverProcess.on('exit', () => resolve());
      setTimeout(() => {
        this.serverProcess?.kill('SIGKILL');
        resolve();
      }, 5000);
    });
    this.serverProcess = null;
  }

  private async waitForSocket(timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(this.socketPath)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`Server socket did not appear within ${timeoutMs}ms`);
  }
}
