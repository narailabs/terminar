'use strict';

const { getServerBinaryPath } = require('./platform.js');
const serverManager = require('./server-manager.js');
const appLauncher = require('./app-launcher.js');

function printVersion() {
  const pkg = require('../package.json');
  console.log(`terminar v${pkg.version}`);
}

function printUsage() {
  console.log(`Usage: terminar [command]

Commands:
  (none)            Start server + desktop app
  server start      Start the server daemon
  server stop       Stop the server
  server restart    Restart the server
  server status     Show server status
  server logs       Tail server logs
  --version, -v     Show version
  --help, -h        Show this help`);
}

async function startEverything() {
  const serverBin = getServerBinaryPath();
  const port = serverManager.DEFAULT_PORT;

  // Check if server is already running
  const existingPid = serverManager.getRunningPid();
  if (!existingPid) {
    serverManager.start(serverBin, port);

    // Wait for the server's Unix socket to appear (the server is
    // Unix-socket-only — there is no HTTP /health endpoint to poll)
    try {
      await serverManager.waitForSocketReady(serverManager.defaultSocketPath());
    } catch {
      console.error('Warning: Server socket check timed out, launching app anyway');
    }
  }

  // Launch Electron tray/desktop app
  appLauncher.launch(serverBin, port, serverManager.defaultSocketPath());
}

async function handleServerCommand(subcommand) {
  const serverBin = getServerBinaryPath();
  const port = serverManager.DEFAULT_PORT;

  switch (subcommand) {
    case 'start':
      serverManager.start(serverBin, port);
      try {
        await serverManager.waitForSocketReady(serverManager.defaultSocketPath());
        console.log('Server is ready');
      } catch {
        console.error('Warning: Server started but socket check timed out');
      }
      break;
    case 'stop':
      serverManager.stop();
      break;
    case 'restart':
      serverManager.restart(serverBin, port);
      try {
        await serverManager.waitForSocketReady(serverManager.defaultSocketPath());
        console.log('Server is ready');
      } catch {
        console.error('Warning: Server restarted but socket check timed out');
      }
      break;
    case 'status':
      serverManager.status();
      break;
    case 'logs':
      serverManager.logs();
      break;
    default:
      console.error(`Unknown server command: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await startEverything();
    return;
  }

  const cmd = args[0];

  switch (cmd) {
    case '--version':
    case '-v':
      printVersion();
      break;
    case '--help':
    case '-h':
      printUsage();
      break;
    case 'server':
      if (!args[1]) {
        console.error('Missing server subcommand');
        printUsage();
        process.exit(1);
      }
      await handleServerCommand(args[1]);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
