/**
 * SocketBridge — Bridges Electron IPC with the terminar-server Unix socket.
 *
 * The main process holds a persistent connection to the server's Unix socket
 * using length-prefixed JSON framing (4-byte big-endian length prefix).
 *
 * Messages from renderer -> main -> socket (with length prefix)
 * Messages from socket -> main -> renderer (stripped of length prefix)
 */

import net from 'net';
import { ipcMain, type BrowserWindow } from 'electron';

export class SocketBridge {
  private socket: net.Socket | null = null;
  private socketPath: string;
  private targetWindow: BrowserWindow | null = null;
  private readBuffer: Buffer = Buffer.alloc(0);
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnected = false;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    this.registerIpcHandlers();
  }

  /** Set the BrowserWindow that should receive server messages. */
  setWindow(win: BrowserWindow | null): void {
    this.targetWindow = win;
  }

  /** Update the socket path (e.g., after server restart). */
  setSocketPath(socketPath: string): void {
    this.socketPath = socketPath;
  }

  /** Connect to the Unix socket. */
  async connect(): Promise<void> {
    if (this.isConnected && this.socket) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);

      this.socket.on('connect', () => {
        console.log('[SocketBridge] Connected to server socket');
        this.isConnected = true;
        this.readBuffer = Buffer.alloc(0);
        resolve();
      });

      this.socket.on('data', (data: Buffer) => {
        this.handleData(data);
      });

      this.socket.on('close', () => {
        console.log('[SocketBridge] Socket closed');
        this.isConnected = false;
        this.socket = null;
      });

      this.socket.on('error', (err: Error) => {
        console.error('[SocketBridge] Socket error:', err.message);
        this.isConnected = false;
        this.socket = null;
        reject(err);
      });
    });
  }

  /** Disconnect from the Unix socket. */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.isConnected = false;
    this.readBuffer = Buffer.alloc(0);
  }

  /** Send a JSON message to the server with length-prefix framing. */
  sendMessage(jsonStr: string): void {
    if (!this.socket || !this.isConnected) {
      console.warn('[SocketBridge] Cannot send - not connected');
      return;
    }

    const msgBuffer = Buffer.from(jsonStr, 'utf-8');
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32BE(msgBuffer.length, 0);

    this.socket.write(Buffer.concat([lenBuffer, msgBuffer]));
  }

  /** Get current connection state. */
  getState(): string {
    return this.isConnected ? 'connected' : 'disconnected';
  }

  /** Clean up all resources. */
  destroy(): void {
    this.disconnect();
    // IPC handlers are registered once and don't need removal
    // (they are per-process, not per-instance)
  }

  // ---- Internal ----

  /** Handle incoming data from the socket (length-prefixed framing). */
  private handleData(data: Buffer): void {
    this.readBuffer = Buffer.concat([this.readBuffer, data]);

    // Process all complete messages in the buffer
    while (this.readBuffer.length >= 4) {
      const msgLen = this.readBuffer.readUInt32BE(0);

      if (this.readBuffer.length < 4 + msgLen) {
        // Incomplete message, wait for more data
        break;
      }

      const msgBytes = this.readBuffer.subarray(4, 4 + msgLen);
      this.readBuffer = this.readBuffer.subarray(4 + msgLen);

      const msgStr = msgBytes.toString('utf-8');
      this.forwardToRenderer(msgStr);
    }
  }

  /** Forward a server message to the renderer process. */
  private forwardToRenderer(msg: string): void {
    if (this.targetWindow && !this.targetWindow.isDestroyed()) {
      this.targetWindow.webContents.send('terminal:response', msg);
    }
  }

  /** Register IPC handlers for renderer communication. */
  private registerIpcHandlers(): void {
    // Renderer sends a message to the server
    ipcMain.on('terminal:message', (_event, msg: string) => {
      this.sendMessage(msg);
    });

    // Renderer requests connection
    ipcMain.handle('terminal:connect', async () => {
      await this.connect();
    });

    // Renderer requests disconnection
    ipcMain.on('terminal:disconnect', () => {
      this.disconnect();
    });

    // Renderer queries connection state
    ipcMain.handle('terminal:state', () => {
      return this.getState();
    });
  }
}
