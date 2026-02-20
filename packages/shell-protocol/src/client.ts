import { EventEmitter } from 'events';
import { z } from 'zod';
import type { ClientMessage, ServerMessage } from './messages.js';
import { ServerMessageSchema } from './messages.js';
import { ParseError, ValidationError } from './errors.js';
import type { TypedEventEmitter } from './typed-emitter.js';

const PROTOCOL_VERSION = '0.2.0';

export interface IShellSocket {
  send(data: string): void;
  close(): void;
  on(event: 'message', listener: (data: string) => void): this;
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (err: any) => void): this;
}

/** Extract a specific variant from the ServerMessage union by its type literal */
type MessageByType<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/** Event map for ShellClient */
export interface ShellClientEvents {
  authenticated: [];
  message: [msg: ServerMessage];
  error: [err: Error];
  close: [];
  // Server message types emitted as individual events
  AuthOk: [msg: MessageByType<'AuthOk'>];
  AuthChallenge: [msg: MessageByType<'AuthChallenge'>];
  SessionList: [msg: MessageByType<'SessionList'>];
  Output: [msg: MessageByType<'Output'>];
  SessionClosed: [msg: MessageByType<'SessionClosed'>];
  Error: [msg: MessageByType<'Error'>];
  PairResponse: [msg: MessageByType<'PairResponse'>];
  Shutdown: [msg: MessageByType<'Shutdown'>];
  ForegroundChanged: [msg: MessageByType<'ForegroundChanged'>];
  SessionActivity: [msg: MessageByType<'SessionActivity'>];
  SessionExited: [msg: MessageByType<'SessionExited'>];
  CwdChanged: [msg: MessageByType<'CwdChanged'>];
  WorkspaceData: [msg: MessageByType<'WorkspaceData'>];
}

const TypedEmitter = EventEmitter as new () => TypedEventEmitter<ShellClientEvents>;

export class ShellClient extends TypedEmitter {
  private socket: IShellSocket | null = null;
  private _authenticated: boolean = false;
  private messageQueue: ClientMessage[] = [];

  constructor(private token: string | null) {
    super();
  }

  get isAuthenticated(): boolean {
    return this._authenticated;
  }

  connect(socket: IShellSocket) {
    this.socket = socket;
    this._authenticated = false;
    this.messageQueue = [];

    socket.on('open', () => {
      if (this.token) {
        this.socket!.send(JSON.stringify({ type: 'auth', token: this.token, protocol_version: PROTOCOL_VERSION }));
      } else {
        // No token — local connection, skip auth
        this._authenticated = true;
        this.emit('authenticated');
        this.flushQueue();
      }
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        const parsed = ServerMessageSchema.safeParse(msg);
        if (parsed.success) {
          if (parsed.data.type === 'AuthOk') {
            this._authenticated = true;
            this.emit('authenticated');
            this.flushQueue();
          }
          this.emit('message', parsed.data);
          // Emit the specific message type event — cast needed for the dynamic dispatch
          (this as any).emit(parsed.data.type, parsed.data);
        } else {
          this.emit('error', new ValidationError(`Invalid message from server: ${z.prettifyError(parsed.error)}`));
        }
      } catch (err) {
        this.emit('error', new ParseError(`Failed to parse message: ${err}`));
      }
    });

    socket.on('close', () => {
      this._authenticated = false;
      this.messageQueue = [];
      this.emit('close');
    });

    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  send(msg: ClientMessage) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    if (!this._authenticated) {
      this.messageQueue.push(msg);
      return;
    }
    this.socket.send(JSON.stringify(msg));
  }

  close() {
    this.socket?.close();
  }

  private flushQueue() {
    const queued = this.messageQueue;
    this.messageQueue = [];
    for (const msg of queued) {
      this.socket!.send(JSON.stringify(msg));
    }
  }
}
