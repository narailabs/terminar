/**
 * Re-exports from the shared shell-protocol package.
 * Uses relative path imports since the web project uses Vite
 * which can resolve TypeScript source files directly.
 */
export {
    BaseWebSocketManager,
    type IWebSocket,
    WS_OPEN,
    WS_CONNECTING,
} from '../../../packages/shell-protocol/src/websocket-manager';

export {
    type ConnectionState,
    type ReconnectConfig,
    DEFAULT_RECONNECT_CONFIG,
    calculateReconnectDelay,
} from '../../../packages/shell-protocol/src/reconnect';

export {
    parseServerMessage,
    type ParsedServerMessage,
    type ActivityType,
} from '../../../packages/shell-protocol/src/parse';

export {
    createErrorFromCode,
} from '../../../packages/shell-protocol/src/errors';
