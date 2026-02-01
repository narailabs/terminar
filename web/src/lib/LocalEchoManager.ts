import { EventEmitter } from 'events';
import type { ConnectionState } from './SessionManager';

/**
 * Local PTY Session Manager - connects to local-pty-server for testing
 *
 * This manager connects to a minimal PTY server (ws://localhost:3002) that
 * provides a real zsh shell, bypassing the main server infrastructure.
 *
 * Usage:
 *   1. Start local PTY server: pnpm local-pty
 *   2. Open app with: ?local-echo=1
 *
 * This helps isolate client-side issues from server-side issues while still
 * testing with a real shell (zsh).
 *
 * Events (same as WebSocketSessionManager):
 * - 'stateChange': (state: ConnectionState) - Connection state changed
 * - 'sessionList': (sessions: SessionInfo[]) - Session list
 * - 'output': (sessionId: string, data: string) - Terminal output
 */
export class LocalEchoManager extends EventEmitter {
  private socket: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private url: string;

  constructor(url: string = 'ws://localhost:3002') {
    super();
    this.url = url;
    console.log('[LocalPTY] Manager created - connecting to local PTY server');
  }

  public getState(): ConnectionState {
    return this.state;
  }

  public getLastSessionList(): any[] {
    return [{
      id: 'local',
      name: 'Local zsh',
      shell: 'zsh',
      cwd: '~',
      started_at: new Date().toISOString(),
    }];
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[LocalPTY] Connecting to ${this.url}...`);
      this.state = 'connecting';
      this.emit('stateChange', 'connecting');

      this.socket = new WebSocket(this.url);

      this.socket.onopen = () => {
        console.log('[LocalPTY] Connected to local PTY server');
        this.state = 'connected';
        this.emit('stateChange', 'connected');

        // Request session list
        this.listSessions();
        resolve();
      };

      this.socket.onerror = (err) => {
        console.error('[LocalPTY] Connection error:', err);
        console.log('[LocalPTY] Make sure local-pty-server is running: pnpm local-pty');
        this.state = 'disconnected';
        this.emit('stateChange', 'disconnected');
        this.emit('error', new Error('Failed to connect to local PTY server. Run: pnpm local-pty'));
        reject(err);
      };

      this.socket.onclose = () => {
        console.log('[LocalPTY] Disconnected');
        this.state = 'disconnected';
        this.emit('stateChange', 'disconnected');
        this.emit('close');
      };

      this.socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[LocalPTY] Failed to parse message:', e);
        }
      };
    });
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'SessionList':
        this.emit('sessionList', msg.sessions);
        break;

      case 'Output':
        this.emit('output', msg.session_id, msg.data);
        break;

      case 'SessionClosed':
        this.emit('sessionClosed', msg.session_id);
        break;

      case 'Error':
        console.error('[LocalPTY] Server error:', msg.message);
        this.emit('error', new Error(msg.message));
        break;

      default:
        console.log('[LocalPTY] Unknown message type:', msg.type);
    }
  }

  public isAuthenticated(): boolean {
    return this.state === 'connected';
  }

  public isConnected(): boolean {
    return this.state === 'connected';
  }

  public listSessions() {
    this.send({ type: 'list_sessions' });
  }

  public createSession(_cwd: string, _shell: string, _env: any, _cols?: number, _rows?: number) {
    // Local PTY server only supports one session
    console.log('[LocalPTY] createSession - using existing local session');
    this.listSessions();
  }

  public attach(sessionId: string) {
    console.log(`[LocalPTY] Attaching to session: ${sessionId}`);
    this.send({ type: 'attach', session_id: sessionId });
  }

  public sendInput(sessionId: string, data: string) {
    // Debug logging
    const escaped = data.replace(/[\x00-\x1f]/g, c =>
      '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')
    );
    console.log(`[LocalPTY] INPUT: "${escaped}"`);

    this.send({ type: 'input', session_id: sessionId, data });
  }

  public renameSession(sessionId: string, newName: string) {
    console.log(`[LocalPTY] Rename not supported in local mode`);
  }

  public killSession(sessionId: string) {
    console.log(`[LocalPTY] Kill not supported in local mode`);
  }

  public resize(sessionId: string, cols: number, rows: number) {
    console.log(`[LocalPTY] Resize: ${cols}x${rows}`);
    this.send({ type: 'resize', session_id: sessionId, cols, rows });
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.state = 'disconnected';
    this.emit('stateChange', 'disconnected');
    this.emit('close');
  }

  public reconnect(): Promise<void> {
    this.disconnect();
    return this.connect();
  }

  private send(msg: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
