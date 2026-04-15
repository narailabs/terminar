'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const {
  APP_NAME,
  resolveElectronAppPath,
  readBundleName,
  verifyPatch,
  patchBundleName,
} = require('../lib/patch-electron.js');

const isDarwin = process.platform === 'darwin';

const MINIMAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Electron</string>
  <key>CFBundleDisplayName</key>
  <string>Electron</string>
</dict>
</plist>
`;

function makeFakeApp(tmpDir) {
  const app = path.join(tmpDir, 'Electron.app');
  fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), MINIMAL_PLIST);
  return app;
}

function readPlistValue(plist, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', plist], {
    encoding: 'utf-8',
  }).trim();
}

describe('patch-electron', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-electron-tests-'));
  });

  after(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('exports APP_NAME as "terminar"', () => {
    assert.strictEqual(APP_NAME, 'terminar');
  });

  it('resolveElectronAppPath returns null on non-darwin', { skip: isDarwin }, () => {
    assert.strictEqual(resolveElectronAppPath(), null);
  });

  it('resolveElectronAppPath returns null when electron is not resolvable', () => {
    if (!isDarwin) return;
    const emptyDir = fs.mkdtempSync(path.join(tmpRoot, 'empty-'));
    assert.strictEqual(resolveElectronAppPath(emptyDir), null);
  });

  it('resolveElectronAppPath finds Electron.app under baseDir/node_modules', () => {
    if (!isDarwin) return;
    const fakeRoot = fs.mkdtempSync(path.join(tmpRoot, 'fake-root-'));
    const electronPkgDir = path.join(fakeRoot, 'node_modules', 'electron');
    fs.mkdirSync(electronPkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(electronPkgDir, 'package.json'),
      JSON.stringify({ name: 'electron', main: 'index.js', version: '0.0.0' }),
    );
    fs.writeFileSync(path.join(electronPkgDir, 'index.js'), '');
    const appContents = path.join(electronPkgDir, 'dist', 'Electron.app', 'Contents');
    fs.mkdirSync(appContents, { recursive: true });
    fs.writeFileSync(path.join(appContents, 'Info.plist'), MINIMAL_PLIST);

    const result = resolveElectronAppPath(fakeRoot);
    assert.ok(result, 'expected a path, got null');
    // require.resolve returns the realpath (macOS resolves /var → /private/var),
    // so compare after normalizing both sides.
    assert.strictEqual(
      fs.realpathSync(result),
      fs.realpathSync(path.join(electronPkgDir, 'dist', 'Electron.app')),
    );
  });

  it('readBundleName returns the current CFBundleName', () => {
    if (!isDarwin) return;
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'read-'));
    const app = makeFakeApp(dir);
    assert.strictEqual(readBundleName(app), 'Electron');
  });

  it('readBundleName returns null when Info.plist is missing', () => {
    if (!isDarwin) return;
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'missing-plist-'));
    const app = path.join(dir, 'Electron.app');
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
    assert.strictEqual(readBundleName(app), null);
  });

  it('verifyPatch returns false for an unpatched bundle', () => {
    if (!isDarwin) return;
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'unpatched-'));
    const app = makeFakeApp(dir);
    assert.strictEqual(verifyPatch(app), false);
  });

  it('patchBundleName rewrites CFBundleName and CFBundleDisplayName', () => {
    if (!isDarwin) return;
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'patch-'));
    const app = makeFakeApp(dir);
    patchBundleName(app);
    const plist = path.join(app, 'Contents', 'Info.plist');
    assert.strictEqual(readPlistValue(plist, 'CFBundleName'), 'terminar');
    assert.strictEqual(readPlistValue(plist, 'CFBundleDisplayName'), 'terminar');
  });

  it('verifyPatch returns true after patchBundleName', () => {
    if (!isDarwin) return;
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'verify-'));
    const app = makeFakeApp(dir);
    patchBundleName(app);
    assert.strictEqual(verifyPatch(app), true);
  });

  it('patchBundleName throws when Info.plist is missing', () => {
    if (!isDarwin) return;
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'missing-'));
    const app = path.join(dir, 'Electron.app');
    fs.mkdirSync(path.join(app, 'Contents'), { recursive: true });
    assert.throws(() => patchBundleName(app), /Info\.plist not found/);
  });
});
