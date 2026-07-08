// IpcSocket.ts — an `IWebSocket`-compatible adapter backed by
// `window.terminarSocket` (exposed by tray/src/preload/terminal.ts), which
// relays to the server's Unix domain socket through the Electron main
// process (see tray/src/main/SocketBridge.ts). Lets BaseWebSocketManager's
// transport-agnostic reconnect/attach logic run unchanged over this
// transport instead of a real WebSocket.

import { WS_CONNECTING, WS_OPEN, type IWebSocket } from '../../../../web/src/lib/shared-protocol';

interface TerminarSocketAPI {
  connect(): Promise<void>;
  send(json: string): void;
  onMessage(callback: (json: string) => void): void;
  onClose(callback: () => void): void;
  disconnect(): void;
  state(): Promise<string>;
  request(json: string): Promise<string>;
}

declare global {
  interface Window {
    terminarSocket?: TerminarSocketAPI;
  }
}

/** True when running inside the tray's terminal window (preload exposed the bridge). */
export function hasIpcSocket(): boolean {
  return typeof window !== 'undefined' && !!window.terminarSocket;
}

type Listener<E> = E extends 'message' ? (event: { data: string }) => void : () => void;

const WS_CLOSED = 3;

export class IpcSocketAdapter implements IWebSocket {
  readyState: number = WS_CONNECTING;

  private listeners: {
    open: Set<() => void>;
    message: Set<(event: { data: string }) => void>;
    close: Set<() => void>;
    error: Set<(event: unknown) => void>;
  } = { open: new Set(), message: new Set(), close: new Set(), error: new Set() };

  constructor() {
    const api = window.terminarSocket;
    if (!api) throw new Error('IpcSocketAdapter: window.terminarSocket is not available');

    api.onMessage((json) => {
      for (const cb of this.listeners.message) cb({ data: json });
    });
    api.onClose(() => {
      this.readyState = WS_CLOSED;
      for (const cb of this.listeners.close) cb();
    });

    api
      .connect()
      .then(() => {
        this.readyState = WS_OPEN;
        for (const cb of this.listeners.open) cb();
      })
      .catch((err) => {
        for (const cb of this.listeners.error) cb(err);
        this.readyState = WS_CLOSED;
        for (const cb of this.listeners.close) cb();
      });
  }

  send(data: string): void {
    window.terminarSocket?.send(data);
  }

  close(): void {
    window.terminarSocket?.disconnect();
  }

  addEventListener<E extends 'open' | 'message' | 'close' | 'error'>(
    event: E,
    listener: Listener<E>,
  ): void {
    (this.listeners[event] as Set<unknown>).add(listener);
  }

  removeEventListener<E extends 'open' | 'message' | 'close' | 'error'>(
    event: E,
    listener: Listener<E>,
  ): void {
    (this.listeners[event] as Set<unknown>).delete(listener);
  }
}
