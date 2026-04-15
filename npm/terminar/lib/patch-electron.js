'use strict';

// Patches the bundled Electron.app so macOS shows "terminar" in the menu bar
// instead of "Electron". macOS reads the menu-bar app name from CFBundleName
// in the running binary's Info.plist — there is no JS-level workaround.
//
// Used by three call sites:
//   - npm/terminar/scripts/patch-electron.cjs  (postinstall)
//   - npm/terminar/lib/app-launcher.js         (runtime self-heal)
//   - tray/scripts/patch-electron.cjs          (dev install)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_NAME = 'terminar';

function plistPath(electronAppPath) {
  return path.join(electronAppPath, 'Contents', 'Info.plist');
}

// Returns the Electron.app path, or null if it can't be resolved.
// baseDir hints where to start the node_modules lookup (defaults to this file's dir).
function resolveElectronAppPath(baseDir) {
  if (process.platform !== 'darwin') return null;
  let electronPkgJson;
  try {
    const opts = baseDir ? { paths: [baseDir] } : undefined;
    electronPkgJson = require.resolve('electron/package.json', opts);
  } catch {
    return null;
  }
  const electronDir = path.dirname(electronPkgJson);
  const appPath = path.join(electronDir, 'dist', 'Electron.app');
  if (!fs.existsSync(plistPath(appPath))) return null;
  return appPath;
}

function readBundleName(electronAppPath) {
  try {
    const out = execFileSync(
      'plutil',
      ['-extract', 'CFBundleName', 'raw', plistPath(electronAppPath)],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.trim();
  } catch {
    return null;
  }
}

function verifyPatch(electronAppPath) {
  return readBundleName(electronAppPath) === APP_NAME;
}

function signTarget(target) {
  try {
    execFileSync('codesign', ['--force', '--sign', '-', target], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Modifies Info.plist to set CFBundleName and CFBundleDisplayName to "terminar",
// then re-signs the bundle bottom-up to restore an ad-hoc signature.
// Throws on plutil failure; swallows codesign failures (non-fatal — app still runs).
function patchBundleName(electronAppPath, { verbose = false } = {}) {
  const plist = plistPath(electronAppPath);
  if (!fs.existsSync(plist)) {
    throw new Error(`Info.plist not found at ${plist}`);
  }

  execFileSync('plutil', ['-replace', 'CFBundleName', '-string', APP_NAME, plist]);
  execFileSync('plutil', ['-replace', 'CFBundleDisplayName', '-string', APP_NAME, plist]);

  // Re-sign bottom-up: framework version → .app/.framework helpers → outer app.
  const frameworks = path.join(electronAppPath, 'Contents', 'Frameworks');
  const fwVersionA = path.join(frameworks, 'Electron Framework.framework', 'Versions', 'A');
  if (fs.existsSync(fwVersionA)) signTarget(fwVersionA);

  if (fs.existsSync(frameworks)) {
    try {
      for (const entry of fs.readdirSync(frameworks)) {
        if (entry.endsWith('.app') || entry.endsWith('.framework')) {
          signTarget(path.join(frameworks, entry));
        }
      }
    } catch {
      // readdir failure is non-fatal
    }
  }

  const outerSigned = signTarget(electronAppPath);
  if (verbose && !outerSigned) {
    console.warn(
      `[terminar] codesign failed on ${electronAppPath}; the bundle is patched ` +
      `but has an invalid signature. The app may still launch.`,
    );
  }

  return { patched: true };
}

module.exports = {
  APP_NAME,
  resolveElectronAppPath,
  readBundleName,
  verifyPatch,
  patchBundleName,
};
