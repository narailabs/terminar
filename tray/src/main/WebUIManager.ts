// WebUIManager.ts — Manages the web UI dev server lifecycle.
// Spawns the Vite dev server in web/ on demand and opens the browser.

import { spawn, type ChildProcess } from 'child_process';
import { shell } from 'electron';
import path from 'path';
import { getAppRoot } from './paths.js';

const WEB_UI_PORT = 3001;
const WEB_UI_URL = `http://localhost:${WEB_UI_PORT}`;

export class WebUIManager {
  private proc: ChildProcess | null = null;

  /** Open the web UI, starting the dev server if needed. */
  async open(): Promise<void> {
    if (await this.isRunning()) {
      void shell.openExternal(WEB_UI_URL);
      return;
    }

    // Start the dev server if we haven't already
    if (!this.proc) {
      this.startDevServer();
    }

    // Wait for the server to become available (up to 15s)
    const ready = await this.waitForReady(15000);
    if (ready) {
      void shell.openExternal(WEB_UI_URL);
    } else {
      console.error('[webui] dev server did not become ready in time');
    }
  }

  private startDevServer(): void {
    const webDir = path.join(getAppRoot(), '..', 'web');
    console.log(`[webui] starting dev server in ${webDir}`);

    this.proc = spawn('pnpm', ['dev'], {
      cwd: webDir,
      stdio: 'ignore',
      detached: true,
    });

    this.proc.unref();

    this.proc.on('error', (err) => {
      console.error(`[webui] dev server error: ${err.message}`);
      this.proc = null;
    });

    this.proc.on('exit', (code) => {
      console.log(`[webui] dev server exited (code=${code})`);
      this.proc = null;
    });
  }

  private async isRunning(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const resp = await fetch(WEB_UI_URL, { signal: controller.signal });
      clearTimeout(timeout);
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isRunning()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /** Kill the dev server if we spawned it. */
  shutdown(): void {
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
