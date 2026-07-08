#!/usr/bin/env node
// scripts/dev.cjs — dev orchestrator.
//
// Replaces the old `concurrently` setup. Starts the Rust server as a DETACHED
// background process (so it survives UI crashes, tray Quit, and Ctrl+C on the
// dev harness), then runs the UI children (tray and/or web) in the foreground.
//
// The server lifecycle is delegated to `npm/terminar/lib/server-manager.js`,
// the same module the production `terminar` CLI uses. This keeps dev and prod
// aligned on one PID file (`~/.terminar/server.pid`), one log file
// (`~/.terminar/logs/server.log`), and one set of semantics for "is it running?".
//
// Usage:
//   node scripts/dev.cjs            # tray only (default)
//   node scripts/dev.cjs tray
//   node scripts/dev.cjs web
//   node scripts/dev.cjs web tray
//
// Invariant: after any close path (UI quit, UI crash, Ctrl+C, SIGTERM), the
// server is still running. Use `pnpm server:stop` for explicit shutdown.

'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ------------------------------------------------------------------
// Paths
// ------------------------------------------------------------------
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');
const DEBUG_BIN = path.join(SERVER_DIR, 'target', 'debug', 'terminar-server');
const PORT = 6750;

// Reuse the production server lifecycle module. Explicit absolute path so this
// works regardless of cwd.
const sm = require(path.join(REPO_ROOT, 'npm', 'terminar', 'lib', 'server-manager.js'));

// ------------------------------------------------------------------
// ANSI helpers
// ------------------------------------------------------------------
const dim = (s) => `\x1b[90m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

// ------------------------------------------------------------------
// Parse args
// ------------------------------------------------------------------
// The server is Unix-socket-only (no network), so the browser-tab web dev
// server can't reach it — the only UI is the tray app, which mounts the same
// web/App.svelte with Vite HMR. The `tray` arg is accepted for compatibility.
const runTray = true;

// ------------------------------------------------------------------
// cargo build
// ------------------------------------------------------------------
function cargoBuild() {
  console.log(cyan('▶ Building terminar-server (cargo build --bin terminar-server)…'));
  const cargoBinDir = path.join(process.env.HOME || '', '.cargo', 'bin');
  const env = {
    ...process.env,
    PATH: `${cargoBinDir}:${process.env.PATH || ''}`,
  };

  return new Promise((resolve, reject) => {
    const child = spawn('cargo', ['build', '--bin', 'terminar-server'], {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      env,
    });
    child.on('error', (err) => {
      reject(new Error(
        `Failed to invoke cargo: ${err.message}. ` +
        `Is Rust installed? Expected cargo at ${cargoBinDir}/cargo`
      ));
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`cargo build exited with code ${code}`));
    });
  });
}

function getBinaryMtime() {
  try {
    return fs.statSync(DEBUG_BIN).mtimeMs;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Ensure server is running
// ------------------------------------------------------------------
async function ensureServer(binaryRebuilt) {
  const existingPid = sm.getRunningPid();
  if (existingPid) {
    console.log(cyan(`▶ Server already running (PID ${existingPid})`));
    if (binaryRebuilt) {
      console.log(yellow(
        `WARNING: terminar-server was rebuilt, but PID ${existingPid} is still running the old binary.`
      ));
      console.log(yellow(
        `         Run 'pnpm server:restart' to pick up changes.`
      ));
    }
    return existingPid;
  }

  if (!fs.existsSync(DEBUG_BIN)) {
    throw new Error(
      `Server binary not found at ${DEBUG_BIN} after cargo build. ` +
      `This shouldn't happen — check the cargo output above.`
    );
  }

  console.log(cyan('▶ Starting terminar-server (detached, Unix socket only)…'));
  // sm.start() spawns with detached:true + unref() and writes the PID file.
  // It also ad-hoc codesigns the binary on macOS.
  const pid = sm.start(DEBUG_BIN, PORT);

  // The server is Unix-socket-only (no HTTP /health endpoint) — wait for the
  // socket file to appear instead.
  try {
    await sm.waitForSocketReady(sm.defaultSocketPath(), 10000);
  } catch (err) {
    console.error(`\n✗ Server socket check failed: ${err.message}`);
    console.error(`  Check logs at ~/.terminar/logs/server.log\n`);
    throw err;
  }

  console.log(cyan(`▶ Server is healthy (PID ${pid})`));
  return pid;
}

// ------------------------------------------------------------------
// Spawn UI child
// ------------------------------------------------------------------
function spawnUi(name) {
  console.log(cyan(`▶ Starting ${name} (pnpm tray:dev)…`));
  const child = spawn('pnpm', ['tray:dev'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  return child;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  const preMtime = getBinaryMtime();
  await cargoBuild();
  const postMtime = getBinaryMtime();
  const binaryRebuilt = preMtime !== null && postMtime !== null && preMtime !== postMtime;

  const serverPid = await ensureServer(binaryRebuilt);

  const children = [];
  if (runTray) children.push({ name: 'tray', child: spawnUi('tray') });

  let shuttingDown = false;
  let closingPrinted = false;

  const printClosingMessage = () => {
    if (closingPrinted) return;
    closingPrinted = true;
    // Atomic multi-line write so nothing gets cut off if the process exits
    // soon after. Using process.stdout.write directly (vs console.log) avoids
    // Node's chunking and flushes reliably on a regular-file FD.
    process.stdout.write(
      '\n' +
      green(`▶ UI closed. Server still running (PID ${serverPid}).`) + '\n' +
      dim('  - Reopen UI:    pnpm dev') + '\n' +
      dim('  - Stop server:  pnpm server:stop') + '\n' +
      dim('  - Server logs:  pnpm server:logs') + '\n' +
      dim('  - Server state: pnpm server:status') + '\n'
    );
  };

  // Exit when all UI children are gone. We set process.exitCode and let the
  // event loop drain naturally (no process.exit()) so stdout writes flush.
  let remaining = children.length;
  for (const { name, child } of children) {
    child.on('exit', (code, signal) => {
      remaining--;
      const why = signal ? `signal ${signal}` : `code ${code ?? 'null'}`;
      process.stdout.write(dim(`[${name}] exited (${why})`) + '\n');
      if (remaining === 0 && !shuttingDown) {
        printClosingMessage();
        process.exitCode = 0;
      }
    });
    child.on('error', (err) => {
      process.stderr.write(`[${name}] failed to spawn: ${err.message}\n`);
    });
  }

  // Ctrl+C / SIGTERM: forward to UI children, wait for them to exit cleanly
  // (Electron needs time to run its SIGTERM handler and tear down Chromium GPU
  // processes gracefully), then exit. The server is detached — signals to us
  // do NOT reach it, so it keeps running.
  const handleSignal = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write('\n' + dim(`Received ${sig} — asking UI children to quit…`) + '\n');

    for (const { child } of children) {
      try {
        child.kill(sig);
      } catch {}
    }

    // Wait for clean exit, with a grace period for Electron teardown.
    const waitAll = Promise.all(
      children.map(({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.on('exit', () => resolve());
        })
      )
    );
    const grace = new Promise((resolve) => setTimeout(resolve, 10000));
    Promise.race([waitAll, grace]).then(() => {
      printClosingMessage();
      process.exitCode = 0;
      // Natural event-loop drain happens here; no process.exit() needed.
    });
  };
  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

main().catch((err) => {
  console.error('\n✗ ' + (err && err.message ? err.message : String(err)) + '\n');
  process.exit(1);
});
