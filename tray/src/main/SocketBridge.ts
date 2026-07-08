// SocketBridge.ts — Bridges a renderer's Electron IPC calls to the
// terminar-server Unix domain socket.
//
// One BrowserWindow = one SocketBridge = one net.Socket, mirroring the
// pre-existing one-WebSocket-per-window topology (each renderer used to open
// its own independent `ws://` connection; this replaces that transport
// without changing the topology). The socket uses the same 4-byte
// big-endian length-prefixed JSON framing as the server's other Unix-socket
// clients (see extension/src/NetSocketAdapter.ts for a second implementation
// of the same framing).

import * as net from 'net';
import * as os from 'os';
import { BrowserWindow, ipcMain } from 'electron';

/** Default Unix socket path — matches the formula independently duplicated in
 *  server/src/main.rs, extension/src/extension.ts, and
 *  npm/terminar/lib/server-manager.js's defaultSocketPath(). */
export function getDefaultSocketPath(): string {
  return `/tmp/vscode-terminar-${os.userInfo().uid}.sock`;
}

// A ClientMessage `type` mapped to the ServerMessage `type` that answers it.
// Used only by request()'s correlated request/response RPC (settings/themes/
// tags/workspace-state) — terminal I/O (create/attach/input/resize/kill/...)
// streams over send()/onMessage() and never goes through this map. Only one
// request() is ever in flight on the wire at a time (request() queues
// concurrent callers); this is a simple correlate-by-response-type design,
// not a general concurrent request multiplexer.
const RESPONSE_TYPE_FOR_REQUEST: Record<string, string> = {
  get_settings: 'SettingsData',
  put_settings: 'SettingsData',
  get_themes: 'ThemesData',
  put_themes: 'ThemesData',
  get_tags: 'TagsData',
  put_tags: 'TagsData',
  get_workspace_state: 'WorkspaceStateData',
  put_workspace_state: 'WorkspaceStateData',
};

interface PendingRequest {
  expectedType: string;
  resolve: (json: string) => void;
  reject: (err: Error) => void;
}

export class SocketBridge {
  private socket: net.Socket | null = null;
  private readBuffer: Buffer = Buffer.alloc(0);
  private isConnected = false;
  private pendingConnect: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private pendingRequest: PendingRequest | null = null;
  private requestQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private win: BrowserWindow,
    private socketPath: string,
  ) {}

  /** Connect to the Unix socket. Resolves once, rejects on error before connect. */
  connect(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    if (this.pendingConnect) {
      return new Promise((resolve, reject) => {
        const prior = this.pendingConnect!;
        this.pendingConnect = {
          resolve: () => {
            prior.resolve();
            resolve();
          },
          reject: (err) => {
            prior.reject(err);
            reject(err);
          },
        };
      });
    }

    return new Promise<void>((resolve, reject) => {
      this.pendingConnect = { resolve, reject };
      this.readBuffer = Buffer.alloc(0);

      const socket = net.createConnection(this.socketPath);
      this.socket = socket;

      socket.on('connect', () => {
        this.isConnected = true;
        this.pendingConnect?.resolve();
        this.pendingConnect = null;
      });

      socket.on('data', (data: Buffer) => {
        this.readBuffer = Buffer.concat([this.readBuffer, data]);
        this.parseFrames();
      });

      socket.on('close', () => {
        this.isConnected = false;
        this.socket = null;
        this.pendingRequest?.reject(new Error('Socket closed'));
        this.pendingRequest = null;
        if (!this.win.isDestroyed()) {
          this.win.webContents.send('terminar:socket:closed');
        }
      });

      socket.on('error', (err: Error) => {
        this.isConnected = false;
        this.socket = null;
        this.pendingConnect?.reject(err);
        this.pendingConnect = null;
        this.pendingRequest?.reject(err);
        this.pendingRequest = null;
      });
    });
  }

  /** Disconnect and release the socket. Idempotent. */
  disconnect(): void {
    this.pendingConnect?.reject(new Error('Disconnected before connect completed'));
    this.pendingConnect = null;
    this.pendingRequest?.reject(new Error('Disconnected'));
    this.pendingRequest = null;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
    this.readBuffer = Buffer.alloc(0);
  }

  /** Fire-and-forget send — the hot path for terminal I/O. */
  send(json: string): void {
    if (!this.socket || !this.isConnected) return;
    const payload = Buffer.from(json, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    this.socket.write(Buffer.concat([header, payload]));
  }

  /**
   * Correlated request/response for settings/themes/tags/workspace-state.
   * Resolves with the raw JSON of the matching response (or an `Error`
   * message, if the server sent one instead) — the caller decides how to
   * interpret it. Only one call is ever in flight on the wire at a time;
   * concurrent callers are queued (each waits for the prior one to settle)
   * rather than rejected, since settings/themes/tags/workspace-state can
   * legitimately be requested back-to-back during startup or from multiple
   * UI panels opened close together.
   */
  request(json: string): Promise<string> {
    const run = this.requestQueue.then(() => this.sendOneRequest(json));
    // Swallow rejections in the queue chain itself (each caller still gets
    // its own rejection via the returned promise) so one failed request
    // doesn't permanently wedge the queue for everything after it.
    this.requestQueue = run.catch(() => {});
    return run;
  }

  private sendOneRequest(json: string): Promise<string> {
    let type: string;
    try {
      type = JSON.parse(json).type;
    } catch {
      return Promise.reject(new Error('request(): payload is not valid JSON'));
    }
    const expectedType = RESPONSE_TYPE_FOR_REQUEST[type];
    if (!expectedType) {
      return Promise.reject(new Error(`request(): unknown message type "${type}"`));
    }

    return new Promise<string>((resolve, reject) => {
      this.pendingRequest = { expectedType, resolve, reject };
      this.send(json);
    });
  }

  getState(): string {
    return this.isConnected ? 'connected' : 'disconnected';
  }

  private parseFrames(): void {
    while (this.readBuffer.length >= 4) {
      const len = this.readBuffer.readUInt32BE(0);
      if (this.readBuffer.length < 4 + len) break;

      const json = this.readBuffer.subarray(4, 4 + len).toString('utf-8');
      this.readBuffer = this.readBuffer.subarray(4 + len);
      if (!json.trim()) continue;

      this.handleMessage(json);
    }
  }

  private handleMessage(json: string): void {
    if (this.pendingRequest) {
      let parsed: { type?: string; message?: string } | undefined;
      try {
        parsed = JSON.parse(json);
      } catch {
        // fall through to broadcast below
      }
      const type = parsed?.type;
      if (type === 'Error') {
        // The server reports save/load failures (permission, disk, not-found)
        // as ServerMessage::Error. Reject so callers (e.g. a settings/theme
        // save) see the failure instead of treating it as success.
        const pending = this.pendingRequest;
        this.pendingRequest = null;
        pending.reject(new Error(parsed?.message ?? 'Server returned an error'));
        return;
      }
      if (type === this.pendingRequest.expectedType) {
        this.pendingRequest.resolve(json);
        this.pendingRequest = null;
        return;
      }
    }

    if (!this.win.isDestroyed()) {
      this.win.webContents.send('terminar:socket:message', json);
    }
  }
}

/** Per-window bridge registry, keyed by webContents.id. */
class SocketBridgeManager {
  private bridges: Map<number, SocketBridge> = new Map();

  getOrCreate(win: BrowserWindow, socketPath: string): SocketBridge {
    const id = win.webContents.id;
    const existing = this.bridges.get(id);
    if (existing) return existing;

    const bridge = new SocketBridge(win, socketPath);
    this.bridges.set(id, bridge);
    return bridge;
  }

  get(webContentsId: number): SocketBridge | undefined {
    return this.bridges.get(webContentsId);
  }

  destroy(webContentsId: number): void {
    const bridge = this.bridges.get(webContentsId);
    if (!bridge) return;
    bridge.disconnect();
    this.bridges.delete(webContentsId);
  }

  /** Disconnect every live bridge. Electron doesn't close `net.Socket`s on
   *  quit, so this must run on `app.on('before-quit')` or fds leak. */
  destroyAll(): void {
    for (const id of [...this.bridges.keys()]) {
      this.destroy(id);
    }
  }
}

export const socketBridgeManager = new SocketBridgeManager();

/** Register the `terminar:socket:*` IPC handlers. Call once at app startup.
 *  `getSocketPath` defaults to `TERMINAR_SOCKET_PATH` (set by
 *  npm/terminar/lib/app-launcher.js to the exact path server-manager.js
 *  resolved when it spawned the server, avoiding drift between the two
 *  independent copies of the default-path formula), falling back to
 *  recomputing the same default when unset (e.g. `pnpm dev`/`pnpm tray:dev`). */
export function registerSocketBridgeIpc(
  getSocketPath: () => string = () => process.env.TERMINAR_SOCKET_PATH || getDefaultSocketPath(),
): void {
  ipcMain.on('terminar:socket:send', (event, json: string) => {
    socketBridgeManager.get(event.sender.id)?.send(json);
  });

  ipcMain.handle('terminar:socket:connect', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('terminar:socket:connect: no owning BrowserWindow');
    const bridge = socketBridgeManager.getOrCreate(win, getSocketPath());
    await bridge.connect();
  });

  ipcMain.on('terminar:socket:disconnect', (event) => {
    socketBridgeManager.destroy(event.sender.id);
  });

  ipcMain.handle('terminar:socket:state', (event) => {
    return socketBridgeManager.get(event.sender.id)?.getState() ?? 'disconnected';
  });

  ipcMain.handle('terminar:socket:request', async (event, json: string) => {
    // Settings/themes/tags/workspace-state can load before the terminal I/O
    // connection is established (App.svelte's onMount awaits these before
    // constructing the session manager) — get-or-create + connect here too,
    // mirroring terminar:socket:connect. connect() is a no-op if already
    // connected, so this is safe to call from either path.
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('terminar:socket:request: no owning BrowserWindow');
    const bridge = socketBridgeManager.getOrCreate(win, getSocketPath());
    await bridge.connect();
    return bridge.request(json);
  });
}
