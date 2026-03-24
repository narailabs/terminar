/**
 * Local PTY Server - Minimal WebSocket server for testing xterm.js with real zsh
 *
 * This bypasses the main server infrastructure to isolate client-side issues.
 * It provides a direct WebSocket-to-PTY connection without authentication,
 * session management, or any other complexity.
 *
 * Usage:
 *   pnpm local-pty          # Start the local PTY server on port 3002
 *   Then open: http://localhost:3001?local-echo=1
 *
 * The web app will connect to ws://localhost:3002 instead of the main server.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

const PORT = 3002;

interface Client {
  ws: WebSocket;
  pty: IPty;
  id: string;
}

const clients = new Map<WebSocket, Client>();
let clientId = 0;

const wss = new WebSocketServer({ port: PORT });

console.log(`\n========================================`);
console.log(`Local PTY Server`);
console.log(`========================================`);
console.log(`WebSocket: ws://localhost:${PORT}`);
console.log(`\nOpen http://localhost:3001?local-echo=1 to test`);
console.log(`Press Ctrl+C to stop\n`);

wss.on('connection', (ws: WebSocket) => {
  const id = `client-${++clientId}`;
  console.log(`[${id}] Connected`);

  // Spawn zsh PTY
  const shell = process.env.SHELL || '/bin/zsh';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME || process.cwd(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as { [key: string]: string },
  });

  const client: Client = { ws, pty: ptyProcess, id };
  clients.set(ws, client);

  console.log(`[${id}] Spawned ${shell} (PID: ${ptyProcess.pid})`);

  // Forward PTY output to WebSocket
  ptyProcess.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      // Send as Output message (same format as main server)
      ws.send(JSON.stringify({
        type: 'Output',
        session_id: 'local',
        data,
      }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[${id}] PTY exited with code ${exitCode}`);
    ws.close();
  });

  // Handle incoming WebSocket messages
  ws.on('message', (message: Buffer) => {
    try {
      const msg = JSON.parse(message.toString());

      switch (msg.type) {
        case 'input':
          // Forward input to PTY
          ptyProcess.write(msg.data);
          break;

        case 'resize':
          // Resize PTY
          ptyProcess.resize(msg.cols, msg.rows);
          console.log(`[${id}] Resize: ${msg.cols}x${msg.rows}`);
          break;

        case 'list_sessions':
          // Return fake session list
          ws.send(JSON.stringify({
            type: 'SessionList',
            sessions: [{
              id: 'local',
              name: 'Local zsh',
              shell,
              cwd: process.env.HOME || process.cwd(),
              started_at: new Date().toISOString(),
            }],
          }));
          break;

        case 'attach':
          // Already attached, just acknowledge
          console.log(`[${id}] Attach request for ${msg.session_id}`);
          break;

        case 'auth':
          // No auth needed, just acknowledge
          console.log(`[${id}] Auth (ignored in local mode)`);
          break;

        default:
          console.log(`[${id}] Unknown message type: ${msg.type}`);
      }
    } catch (e) {
      console.error(`[${id}] Failed to parse message:`, e);
    }
  });

  ws.on('close', () => {
    console.log(`[${id}] Disconnected`);
    ptyProcess.kill();
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error(`[${id}] WebSocket error:`, err);
  });
});

wss.on('error', (err) => {
  console.error('Server error:', err);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  for (const client of clients.values()) {
    client.pty.kill();
    client.ws.close();
  }
  wss.close();
  process.exit(0);
});
