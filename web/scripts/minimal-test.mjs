#!/usr/bin/env node
/**
 * Minimal test - just create a session and watch if it exits on its own
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:6749/ws';
let ws;
let sessionId = null;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function send(message) {
  const json = JSON.stringify(message);
  log(`Sending: ${json}`);
  ws.send(json);
}

async function main() {
  log('Connecting...');

  ws = new WebSocket(WS_URL);

  ws.on('open', async () => {
    log('Connected');

    // Create session
    send({
      type: 'create_session',
      cwd: '/',
      shell: '/bin/sh',
      env: {},
      cols: 80,
      rows: 24,
    });
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    log(`Received: ${msg.type} (${msg.data?.length || 0} bytes)`);

    if (msg.type === 'SessionList' && msg.sessions?.length > 0 && !sessionId) {
      sessionId = msg.sessions[0].id;
      log(`Session created: ${sessionId}`);

      // Attach to session
      send({
        type: 'attach',
        session_id: sessionId,
        mode: 'rw',
      });
    }

    if (msg.type === 'Output') {
      // Log the actual output data
      const displayData = msg.data.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      log(`Output data: "${displayData}"`);
    }

    if (msg.type === 'SessionClosed') {
      log('SESSION CLOSED - Shell exited!');
      ws.close();
    }
  });

  ws.on('error', (err) => {
    log(`Error: ${err.message}`);
  });

  ws.on('close', () => {
    log('Connection closed');
    process.exit(0);
  });

  // Wait 10 seconds, then send a test command if session is still alive
  setTimeout(() => {
    if (sessionId) {
      log('10 seconds passed - sending test command');
      send({
        type: 'input',
        session_id: sessionId,
        data: 'echo hello\n',
      });
    }
  }, 10000);

  // Exit after 15 seconds
  setTimeout(() => {
    log('15 seconds timeout - exiting');
    ws.close();
  }, 15000);
}

main();
