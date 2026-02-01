import { EventEmitter } from 'events';

/**
 * Connection states for session managers
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Session information
 */
export interface SessionInfo {
  id: string;
  name: string;
  shell: string;
  cwd: string;
  started_at: string;
}

/**
 * Common interface for session managers
 *
 * Both WebSocketSessionManager and LocalEchoManager implement this interface,
 * allowing components to work with either manager type.
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
