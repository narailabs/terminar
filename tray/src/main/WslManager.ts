// WslManager.ts — WSL detection and stdio server bridge for Windows.
// On Windows, terminar-server is a Linux binary that must run inside WSL.
// This module handles WSL detection, binary installation, and server spawning.

import { execSync, spawn, type ChildProcess } from 'child_process';

export class WslManager {
  static isWindows(): boolean {
    return process.platform === 'win32';
  }

  static isWslInstalled(): boolean {
    try {
      execSync('wsl.exe --status', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  static hasDistro(): boolean {
    try {
      const output = execSync('wsl.exe --list --quiet', {
        stdio: 'pipe', encoding: 'utf-8', timeout: 5000,
      });
      // Filter out empty lines and BOM characters
      const lines = output.replace(/\uFEFF/g, '').trim().split('\n').filter(l => l.trim());
      return lines.length > 0;
    } catch {
      return false;
    }
  }

  static getDefaultDistro(): string | null {
    try {
      const output = execSync('wsl.exe --list --quiet', {
        stdio: 'pipe', encoding: 'utf-8', timeout: 5000,
      });
      const lines = output.replace(/\uFEFF/g, '').trim().split('\n').filter(l => l.trim());
      return lines[0]?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Spawn server inside WSL using stdio mode.
   * Communication happens over stdin/stdout instead of a Unix socket.
   */
  static spawnServer(serverBinaryWslPath: string): ChildProcess {
    return spawn('wsl.exe', [serverBinaryWslPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Copy server binary into WSL filesystem and make it executable.
   * Converts the Windows path to a WSL path, then copies and chmods.
   */
  static async installServerBinary(windowsBundledPath: string, wslTargetPath: string): Promise<void> {
    // Convert Windows path to WSL path
    const escapedPath = windowsBundledPath.replace(/'/g, "'\\''");
    const wslSourcePath = execSync(`wsl.exe wslpath '${escapedPath}'`, {
      stdio: 'pipe', encoding: 'utf-8', timeout: 5000,
    }).trim();

    // Ensure target directory exists
    const wslTargetDir = wslTargetPath.substring(0, wslTargetPath.lastIndexOf('/'));
    execSync(`wsl.exe mkdir -p '${wslTargetDir}'`, { stdio: 'pipe', timeout: 5000 });

    // Copy and make executable
    execSync(`wsl.exe cp '${wslSourcePath}' '${wslTargetPath}'`, { stdio: 'pipe', timeout: 10000 });
    execSync(`wsl.exe chmod +x '${wslTargetPath}'`, { stdio: 'pipe', timeout: 5000 });
  }

  /**
   * Check if server binary exists and is executable in WSL.
   */
  static isServerInstalled(wslPath: string): boolean {
    try {
      execSync(`wsl.exe test -x '${wslPath}'`, { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
