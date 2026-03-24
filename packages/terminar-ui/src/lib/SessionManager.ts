import { EventEmitter } from 'events';

/**
 * Session info returned by the server.
 */
export interface SessionInfo {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  started_at: string;
  state?: string;
  foreground_process?: string;
  last_activity_at?: string;
  exit_code?: number;
}

/**
 * Connection state for session managers.
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error';

/**
 * Common interface for session managers.
 *
 * Both WebSocketSessionManager and custom implementations should
 * implement this interface for use with <terminar-terminal>.
 */
export interface SessionManager extends EventEmitter {
  // Connection state
  getState(): ConnectionState;
  isConnected(): boolean;
  isAuthenticated(): boolean;
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): Promise<void>;

  // Session management
  getLastSessionList(): SessionInfo[];
  listSessions(): void;
  createSession(cwd: string, shell: string, env: any, cols?: number, rows?: number): void;
  attach(sessionId: string): void;
  killSession(sessionId: string): void;
  renameSession(sessionId: string, newName: string): void;

  // Terminal I/O
  sendInput(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
}
