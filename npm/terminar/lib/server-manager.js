'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const os = require('os');

const TERMINAR_DIR = path.join(os.homedir(), '.terminar');
const LOGS_DIR = path.join(TERMINAR_DIR, 'logs');
const PID_FILE = path.join(TERMINAR_DIR, 'server.pid');
const LOG_FILE = path.join(LOGS_DIR, 'server.log');
const DEFAULT_PORT = 6750;

function ensureDirs() {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function readPid() {
  try {
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getRunningPid() {
  const pid = readPid();
  if (pid !== null && isProcessAlive(pid)) {
    return pid;
  }
  // Clean up stale PID file
  if (pid !== null) {
    try { fs.unlinkSync(PID_FILE); } catch {}
  }
  return null;
}

function start(serverBinaryPath, port) {
  port = port || DEFAULT_PORT;

  const existing = getRunningPid();
  if (existing) {
    console.log(`Server already running (PID ${existing})`);
    return existing;
  }

  ensureDirs();

  // Ad-hoc sign on macOS (required for Sequoia network access)
  if (process.platform === 'darwin') {
    try {
      execFileSync('codesign', ['--force', '--sign', '-', serverBinaryPath], { stdio: 'ignore' });
    } catch {}
  }

  const logFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(serverBinaryPath, ['--no-auth', '--port', String(port)], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });

  child.unref();
  fs.closeSync(logFd);

  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`Server started (PID ${child.pid})`);

  return child.pid;
}

function stop() {
  const pid = getRunningPid();
  if (!pid) {
    console.log('Server is not running');
    return false;
  }

  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    } catch {
      console.error(`Failed to stop server (PID ${pid})`);
      return false;
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      console.error(`Failed to stop server (PID ${pid})`);
      return false;
    }
  }

  try { fs.unlinkSync(PID_FILE); } catch {}

  console.log(`Server stopped (PID ${pid})`);
  return true;
}

function restart(serverBinaryPath, port) {
  stop();
  return start(serverBinaryPath, port);
}

function status() {
  const pid = getRunningPid();
  if (!pid) {
    console.log('Server is not running');
    return null;
  }
  console.log(`Server running (PID ${pid})`);
  return pid;
}

function logs() {
  if (!fs.existsSync(LOG_FILE)) {
    console.log('No log file found');
    return;
  }

  if (process.platform === 'win32') {
    // On Windows, read the last lines and watch for changes
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.split('\n').slice(-50);
    lines.forEach((line) => { if (line) console.log(line); });

    const watcher = fs.watch(LOG_FILE, () => {
      const newContent = fs.readFileSync(LOG_FILE, 'utf-8');
      const newLines = newContent.split('\n').slice(-1);
      newLines.forEach((line) => { if (line) console.log(line); });
    });

    process.on('SIGINT', () => { watcher.close(); process.exit(0); });
  } else {
    const { spawnSync } = require('child_process');
    spawnSync('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
  }
}

function waitForHealth(port, timeoutMs) {
  port = port || DEFAULT_PORT;
  timeoutMs = timeoutMs || 5000;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    function check() {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      });

      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error('Server health check timed out'));
        return;
      }
      setTimeout(check, 250);
    }

    check();
  });
}

module.exports = {
  start,
  stop,
  restart,
  status,
  logs,
  waitForHealth,
  getRunningPid,
  DEFAULT_PORT,
  PID_FILE,
  LOG_FILE,
};
