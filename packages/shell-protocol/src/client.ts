import { EventEmitter } from 'events';
import { z } from 'zod';
import type { ClientMessage, ServerMessage } from './messages.js';
import { ServerMessageSchema } from './messages.js';
import { ParseError, ValidationError } from './errors.js';
import type { TypedEventEmitter } from './typed-emitter.js';

export interface IShellSocket {
  send(data: string): void;
  close(): void;
  on(event: 'message', listener: (data: string) => void): this;
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (err: any) => void): this;
  removeAllListeners(event?: string): this;
}

/** Extract a specific variant from the ServerMessage union by its type literal */
type MessageByType<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

/** Event map for ShellClient */
export interface ShellClientEvents {
  connected: [];
  message: [msg: ServerMessage];
  error: [err: Error];
  close: [];
  // Server message types emitted as individual events
  SessionList: [msg: MessageByType<'SessionList'>];
  Output: [msg: MessageByType<'Output'>];
  SessionClosed: [msg: MessageByType<'SessionClosed'>];
  Error: [msg: MessageByType<'Error'>];
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

  constructor() {
    super();
  }

  connect(socket: IShellSocket) {
    // Detach listeners from the old socket to prevent event leaks on reconnect
    if (this.socket) {
      this.socket.removeAllListeners();
    }
    this.socket = socket;

    socket.on('open', () => {
      this.emit('connected');
    });

    socket.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        const parsed = ServerMessageSchema.safeParse(msg);
        if (parsed.success) {
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
    this.socket.send(JSON.stringify(msg));
  }

  close() {
    this.socket?.close();
  }
}
