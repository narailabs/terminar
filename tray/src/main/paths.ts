// paths.ts — Centralized path resolution for the Electron tray app.
// Avoids __dirname (unavailable in ESM) by using app.getAppPath().

import { app } from 'electron';
import path from 'path';

let _appRoot: string | null = null;

/**
 * Project root directory — the tray/ directory where package.json lives.
 *
 * Lazily resolved on first access so that this module can be imported without
 * triggering side-effects (important for unit tests that don't run in Electron).
 *
 * app.getAppPath() returns different values depending on launch method:
 *   - `electron .`                       → tray/
 *   - `electron dist-electron/index.js`  → tray/dist-electron/
 * Normalize to always return the tray/ directory.
 */
export function getAppRoot(): string {
  if (_appRoot === null) {
    const appPath = app.getAppPath();
    _appRoot = appPath.endsWith('dist-electron')
      ? path.dirname(appPath)
      : appPath;
  }
  return _appRoot;
}
