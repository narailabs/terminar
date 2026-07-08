// IpcSessionManager.ts — SessionManager for the tray's terminal window.
// Identical to WebSocketSessionManager except the transport is the Unix
// domain socket via IpcSocketAdapter instead of a real `ws://` WebSocket.

import { WebSocketSessionManager } from '../../../../web/src/lib/WebSocketSessionManager';
import type { IWebSocket } from '../../../../web/src/lib/shared-protocol';
import { IpcSocketAdapter } from './IpcSocket';

export class IpcSessionManager extends WebSocketSessionManager {
  protected createWebSocket(_url: string): IWebSocket {
    return new IpcSocketAdapter();
  }
}
