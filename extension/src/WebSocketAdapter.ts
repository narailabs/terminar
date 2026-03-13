import WebSocket from 'ws';
import { BaseWebSocketManager, type IWebSocket, type ReconnectConfig } from '@narai/terminar-protocol';

// Re-export types for backward compatibility
export type { ConnectionState, ReconnectConfig, SessionInfo } from '@narai/terminar-protocol';

/**
 * WebSocket-based Session Manager for remote connections (VS Code extension).
 * Uses Node.js `ws` library for WebSocket implementation.
 */
export class WebSocketSessionManager extends BaseWebSocketManager {
    constructor(
        wsUrl: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super(wsUrl, reconnectConfig);
    }

    protected createWebSocket(url: string): IWebSocket {
        return new WebSocket(url) as unknown as IWebSocket;
    }
}
