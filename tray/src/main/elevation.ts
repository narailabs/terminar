// elevation.ts — Port of elevation logic from tray/src-tauri/src/commands.rs
// Platform-appropriate privilege elevation for service management scripts.

import { spawn, execFile } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Run a shell script with platform-appropriate elevation.
 *
 * - macOS: writes script to a temp file, spawns `osascript` with
 *   "do shell script ... with administrator privileges" in the background.
 *   Fire-and-forget: the function returns immediately, the health poller
 *   detects state changes automatically.
 *
 * - Linux: writes script to a temp file, runs `pkexec bash <file>` with
 *   an async callback.
 *
 * Throws on unsupported platforms or if the temp file cannot be written.
 */
export function runElevated(script: string): void {
  if (process.platform === 'darwin') {
    runElevatedMacos(script);
  } else if (process.platform === 'linux') {
    runElevatedLinux(script);
  } else {
    throw new Error(
      'Elevated execution not supported on this platform',
    );
  }
}

function runElevatedMacos(script: string): void {
  const tmpPath = join(tmpdir(), 'terminar-service-cmd.sh');
  writeFileSync(tmpPath, script, 'utf-8');

  const escapedPath = tmpPath
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  const osaScript = `do shell script "bash '${escapedPath}'" with administrator privileges`;

  const child = spawn('osascript', ['-e', osaScript], {
    stdio: 'ignore',
    detached: true,
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[elevated] failed with exit code ${code}`);
    } else {
      console.error('[elevated] success');
    }
  });

  child.on('error', (err) => {
    console.error(`[elevated] spawn error: ${err.message}`);
  });

  child.unref();
}

function runElevatedLinux(script: string): void {
  const tmpPath = join(tmpdir(), 'terminar-service-cmd.sh');
  writeFileSync(tmpPath, script, 'utf-8');

  execFile('pkexec', ['bash', tmpPath], (error, _stdout, stderr) => {
    // Clean up temp file after execution completes
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }

    if (error) {
      console.error(`[elevated] failed: ${stderr || error.message}`);
    } else {
      console.error('[elevated] success');
    }
  });
}
