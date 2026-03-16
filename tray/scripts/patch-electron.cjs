// Patch Electron.app for dev: set bundle name to "terminar" and replace the
// default icon. Then re-sign so macOS doesn't kill child processes (GPU,
// network service) due to an invalid code signature.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const electronApp = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app',
);
const plist = path.join(electronApp, 'Contents', 'Info.plist');
const icns = path.join(
  electronApp, 'Contents', 'Resources', 'electron.icns',
);
const customIcon = path.join(__dirname, '..', 'icons', 'icon.icns');

if (!fs.existsSync(plist)) {
  // Electron not installed yet (e.g. CI with --ignore-scripts)
  process.exit(0);
}

// 1. Patch Info.plist
execSync(
  `plutil -replace CFBundleName -string terminar "${plist}" && ` +
  `plutil -replace CFBundleDisplayName -string terminar "${plist}"`,
);

// 2. Replace default icon
try {
  fs.copyFileSync(customIcon, icns);
} catch {
  // Icon file may not exist yet
}

// 3. Re-sign to restore valid ad-hoc signature.
//    Sign inner frameworks/helpers bottom-up, then the outer .app.
if (process.platform === 'darwin') {
  const frameworks = path.join(electronApp, 'Contents', 'Frameworks');
  const sign = (target) => {
    try {
      execSync(`codesign --force --sign - "${target}"`, { stdio: 'ignore' });
    } catch {
      // Non-fatal — dev still works, just with noisy GPU/network errors
    }
  };

  // Framework version first, then the framework bundle
  const fwVersionA = path.join(
    frameworks, 'Electron Framework.framework', 'Versions', 'A',
  );
  if (fs.existsSync(fwVersionA)) sign(fwVersionA);

  // All helper apps
  try {
    for (const entry of fs.readdirSync(frameworks)) {
      const full = path.join(frameworks, entry);
      if (entry.endsWith('.app')) sign(full);
      if (entry.endsWith('.framework')) sign(full);
    }
  } catch {
    // Ignore readdir errors
  }

  // Outer app
  sign(electronApp);
}
