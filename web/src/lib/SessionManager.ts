import type { ConnectionState, SessionInfo } from './shared-protocol';

// Re-export for backward compatibility
export type { ConnectionState } from './shared-protocol';
export type { SessionInfo } from './shared-protocol';

/**
 * Common interface for session managers.
 *
 * WebSocketSessionManager implements this interface for local server connections.
 *
 * The interface declares only the EventEmitter methods actually used by callers
 * (`on`, `off`, `removeAllListeners`) rather than extending the full EventEmitter
 * type, because BaseWebSocketManager uses a typed-emitter pattern that narrows
 * the event signatures and isn't structurally assignable to the raw EventEmitter.
 */
export interface SessionManager {
  // EventEmitter surface (subset used by callers)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(event?: string): this;
  /** Optional: used by Terminal.svelte for debug logging. */
  listenerCount?(event: string): number;

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
  createSession(
    cwd: string,
    shell: string,
    env: any,
    cols?: number,
    rows?: number,
    containerId?: string,
    sshConnectionId?: string,
  ): void;
  attach(sessionId: string): void;
  killSession(sessionId: string): void;
  renameSession(sessionId: string, newName: string): void;

  // Terminal I/O
  sendInput(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;

  // Editor integration (remote $EDITOR via OSC 7777 edit_request)
  sendEditReply(sessionId: string, id: string, contents: string, cancelled: boolean): void;

  // Docker integration
  listContainers(sshConnectionId?: string): void;

  // SSH integration
  listSshConnections(): void;
  addSshConnection(name: string, host: string, user: string, port: number): void;
  updateSshConnection(id: string, name: string, host: string, user: string, port: number): void;
  removeSshConnection(id: string): void;
  importSshConfig(): void;
}
