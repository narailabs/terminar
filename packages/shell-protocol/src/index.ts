export const VERSION = '0.1.0';
export const PROTOCOL_VERSION = '0.2.0';

// Export message types and schemas
export {
    ClientMessage,
    ClientMessageSchema,
    ServerMessage,
    ServerMessageSchema,
    SessionInfo,
    SessionInfoSchema,
} from './messages.js';

// Export client
export { ShellClient, IShellSocket } from './client.js';
export type { ShellClientEvents } from './client.js';

// Export error types
export {
    ShellProtocolError,
    SessionError,
    ParseError,
    ValidationError,
    PtyError,
    RateLimitError,
    InvalidInputError,
    InternalError,
    createErrorFromCode,
} from './errors.js';
export type { ErrorCode } from './errors.js';

// Export reconnection utilities
export {
    type ConnectionState,
    type ReconnectConfig,
    DEFAULT_RECONNECT_CONFIG,
    calculateReconnectDelay,
} from './reconnect.js';

// Export message parsing
export { parseServerMessage } from './parse.js';
export type { ParsedServerMessage, ActivityType } from './parse.js';

// Export WebSocket base manager
export { BaseWebSocketManager, type IWebSocket, WS_OPEN, WS_CONNECTING } from './websocket-manager.js';
export type { WebSocketManagerEvents } from './websocket-manager.js';

// Export typed emitter utility
export type { TypedEventEmitter, EventMap } from './typed-emitter.js';
