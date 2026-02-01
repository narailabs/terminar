export const VERSION = '0.1.0';

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

// Export error types
export {
    ShellProtocolError,
    AuthError,
    SessionError,
    ParseError,
    ValidationError,
} from './errors.js';
export type { ErrorCode } from './errors.js';