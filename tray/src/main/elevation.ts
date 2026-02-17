// elevation.ts — Port of elevation logic from tray/src-tauri/src/commands.rs
// Platform-appropriate privilege elevation for service management scripts.

import { execFile } from 'child_process';
import { writeFileSync, unlinkSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Run a shell script with platform-appropriate elevation.
 *
 * - macOS: writes script to a temp file, runs `osascript` with
 *   "do shell script ... with administrator privileges". Uses execFile
 *   (async callback) so it doesn't block the event loop. The health poller
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

/**
 * Write a script to a uniquely-named temp file and return its path.
 * Uses timestamp + random suffix to prevent race conditions between
 * concurrent elevated operations.
 */
function writeTempScript(script: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = join(tmpdir(), `terminar-service-${suffix}.sh`);
  writeFileSync(tmpPath, script, 'utf-8');
  chmodSync(tmpPath, 0o700);
  return tmpPath;
}

/** Clean up a temp script file, ignoring errors. */
function cleanupTempScript(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
  } catch {
    // ignore cleanup errors
  }
}

function runElevatedMacos(script: string): void {
  const tmpPath = writeTempScript(script);

  // Escape the path for embedding inside an AppleScript double-quoted string
  const escapedPath = tmpPath
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  const osaScript = `do shell script "bash '${escapedPath}'" with administrator privileges`;

  // Use execFile (NOT spawn with detached:true). The detached option calls
  // setsid() which creates a new session disconnected from the user's login
  // session, preventing osascript from showing the macOS authorization dialog.
  // execFile runs the child in the same session, allowing the GUI auth prompt.
  execFile('osascript', ['-e', osaScript], (error, _stdout, stderr) => {
    cleanupTempScript(tmpPath);

    if (error) {
      console.error(`[elevation] osascript failed: ${stderr || error.message}`);
    } else {
      console.log('[elevation] script executed successfully');
    }
  });
}

function runElevatedLinux(script: string): void {
  const tmpPath = writeTempScript(script);

  execFile('pkexec', ['bash', tmpPath], (error, _stdout, stderr) => {
    cleanupTempScript(tmpPath);

    if (error) {
      console.error(`[elevation] pkexec failed: ${stderr || error.message}`);
    } else {
      console.log('[elevation] script executed successfully');
    }
  });
}
