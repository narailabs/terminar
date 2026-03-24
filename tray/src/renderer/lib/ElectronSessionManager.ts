/**
 * ElectronSessionManager — IPC-based session manager for the Electron renderer.
 *
 * Implements the same SessionManager interface as the web's WebSocketSessionManager,
 * but communicates with the server via Electron IPC (main process holds the Unix
 * socket connection).
 *
 * Message flow:
 *   Renderer  --IPC-->  Main process  --Unix socket-->  terminar-server
 *   Renderer  <--IPC--  Main process  <--Unix socket--  terminar-server
 */

import { EventEmitter } from 'events';
import type { SessionManager } from './SessionManager';
import type { ConnectionState, SessionInfo } from './shared-protocol';
import { parseServerMessage } from './shared-protocol';

declare global {
  interface Window {
    terminalAPI: {
      sendTerminalMessage: (msg: string) => void;
      onTerminalMessage: (callback: (msg: string) => void) => (() => void);
      connect: () => Promise<void>;
      disconnect: () => void;
      getConnectionState: () => Promise<string>;
    };
  }
}

export class ElectronSessionManager extends EventEmitter implements SessionManager {
  private state: ConnectionState = 'disconnected';
  private lastSessionList: SessionInfo[] = [];
  private cleanupListener: (() => void) | null = null;

  constructor() {
    super();
  }

  getState(): ConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  isAuthenticated(): boolean {
    // In local Electron mode, no auth is needed
    return this.state === 'connected';
  }

  getLastSessionList(): SessionInfo[] {
    return this.lastSessionList;
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    this.emit('stateChange', 'connecting');

    // Set up the message listener from main process
    if (this.cleanupListener) {
      this.cleanupListener();
    }

    this.cleanupListener = window.terminalAPI.onTerminalMessage((msg: string) => {
      this.handleServerMessage(msg);
    });

    try {
      await window.terminalAPI.connect();
      this.state = 'connected';
      this.emit('stateChange', 'connected');
    } catch (err) {
      this.state = 'disconnected';
      this.emit('stateChange', 'disconnected');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  disconnect(): void {
    if (this.cleanupListener) {
      this.cleanupListener();
      this.cleanupListener = null;
    }
    window.terminalAPI.disconnect();
    this.state = 'disconnected';
    this.emit('stateChange', 'disconnected');
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    await this.connect();
  }

  listSessions(): void {
    this.sendMessage({ type: 'list_sessions' });
  }

  createSession(cwd: string, shell: string, env: Record<string, string>, cols?: number, rows?: number): void {
    this.sendMessage({
      type: 'create_session',
      cwd,
      shell,
      env: env || {},
      cols: cols || 80,
      rows: rows || 24,
    });
  }

  attach(sessionId: string): void {
    this.sendMessage({
      type: 'attach',
      session_id: sessionId,
      mode: 'rw',
    });
  }

  killSession(sessionId: string): void {
    this.sendMessage({
      type: 'kill_session',
      session_id: sessionId,
    });
  }

  renameSession(sessionId: string, newName: string): void {
    this.sendMessage({
      type: 'rename_session',
      session_id: sessionId,
      new_name: newName,
    });
  }

  sendInput(sessionId: string, data: string): void {
    this.sendMessage({
      type: 'input',
      session_id: sessionId,
      data,
    });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sendMessage({
      type: 'resize',
      session_id: sessionId,
      cols,
      rows,
    });
  }

  private sendMessage(msg: Record<string, unknown>): void {
    if (this.state !== 'connected') {
      console.warn('[ElectronSession] Cannot send message - not connected');
      return;
    }
    window.terminalAPI.sendTerminalMessage(JSON.stringify(msg));
  }

  private handleServerMessage(rawMsg: string): void {
    try {
      let rawObj: unknown;
      try {
        rawObj = JSON.parse(rawMsg);
      } catch {
        console.error('[ElectronSession] Invalid JSON from server');
        return;
      }

      const parsed = parseServerMessage(rawObj);
      if (!parsed) {
        // Check for AuthOk which is not in ServerMessageSchema
        if (rawObj && typeof rawObj === 'object' && 'type' in rawObj && (rawObj as Record<string, unknown>).type === 'AuthOk') {
          this.emit('authenticated');
          return;
        }
        return;
      }

      switch (parsed.type) {
        case 'SessionList':
          this.lastSessionList = parsed.sessions;
          this.emit('sessionList', parsed.sessions);
          break;

        case 'Output':
          this.emit('output', parsed.session_id, parsed.data);
          break;

        case 'SessionClosed':
          this.emit('sessionClosed', parsed.session_id);
          break;

        case 'SessionExited':
          this.emit('sessionExited', parsed.session_id, parsed.exit_code);
          break;

        case 'CwdChanged':
          this.emit('cwdChanged', parsed.session_id, parsed.cwd);
          break;

        case 'ForegroundChanged':
          this.emit('foregroundChanged', parsed.session_id, parsed.process_name);
          break;

        case 'SessionActivity':
          this.emit('sessionActivity', parsed.session_id, parsed.activity_type);
          break;

        case 'Shutdown':
          this.emit('shutdown', parsed.reason || 'Server shutting down');
          break;

        case 'Error':
          this.emit('error', new Error(parsed.message || 'Unknown server error'));
          break;

        case 'WorkspaceData':
          // Handled by workspace store if needed
          break;
      }
    } catch (err) {
      console.error('[ElectronSession] Failed to parse server message:', err);
    }
  }
}
