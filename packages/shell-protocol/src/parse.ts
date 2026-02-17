/**
 * Lightweight runtime validation for server messages.
 * Avoids Zod dependency at runtime — suitable for browser and Node.js.
 */

/** Activity types that appear in SessionActivity messages */
export type ActivityType = 'activity' | 'bell' | 'silence';

/** Parsed server message (union of all server message types) */
export type ParsedServerMessage =
    | { type: 'SessionList'; sessions: Array<Record<string, unknown>> }
    | { type: 'Output'; session_id: string; data: string }
    | { type: 'SessionClosed'; session_id: string }
    | { type: 'SessionActivity'; session_id: string; activity_type: ActivityType }
    | { type: 'SessionExited'; session_id: string; exit_code: number | null }
    | { type: 'ForegroundChanged'; session_id: string; process_name: string | null }
    | { type: 'CwdChanged'; session_id: string; cwd: string }
    | { type: 'Error'; message: string; error_code?: string }
    | { type: 'Shutdown'; reason: string }
    | { type: 'AuthOk'; token: string; expires: string; protocol_version?: string; refresh_token?: string }
    | { type: 'AuthChallenge'; nonce: string }
    | { type: 'WorkspaceData'; workspace: Record<string, unknown> | null };

const VALID_SERVER_TYPES = new Set<string>([
    'SessionList', 'Output', 'SessionClosed', 'SessionActivity', 'SessionExited',
    'ForegroundChanged', 'CwdChanged', 'Error', 'Shutdown', 'AuthOk', 'AuthChallenge',
    'WorkspaceData',
]);

const VALID_ACTIVITY_TYPES = new Set<string>(['activity', 'bell', 'silence']);

/**
 * Parse and validate a raw object as a server message.
 * Returns the typed message if valid, or null if unknown/malformed.
 */
export function parseServerMessage(raw: unknown): ParsedServerMessage | null {
    if (raw === null || raw === undefined || typeof raw !== 'object') {
        return null;
    }

    const msg = raw as Record<string, unknown>;

    if (typeof msg.type !== 'string' || !VALID_SERVER_TYPES.has(msg.type)) {
        return null;
    }

    switch (msg.type) {
        case 'SessionList':
            if (!Array.isArray(msg.sessions)) return null;
            return raw as ParsedServerMessage;
        case 'Output':
            if (typeof msg.session_id !== 'string' || typeof msg.data !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'SessionClosed':
            if (typeof msg.session_id !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'SessionActivity':
            if (typeof msg.session_id !== 'string') return null;
            if (typeof msg.activity_type !== 'string' || !VALID_ACTIVITY_TYPES.has(msg.activity_type)) return null;
            return raw as ParsedServerMessage;
        case 'SessionExited':
            if (typeof msg.session_id !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'ForegroundChanged':
            if (typeof msg.session_id !== 'string') return null;
            if (msg.process_name !== null && typeof msg.process_name !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'CwdChanged':
            if (typeof msg.session_id !== 'string' || typeof msg.cwd !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'Error':
            if (typeof msg.message !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'Shutdown':
            if (typeof msg.reason !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'AuthOk':
            if (typeof msg.token !== 'string' || typeof msg.expires !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'AuthChallenge':
            if (typeof msg.nonce !== 'string') return null;
            return raw as ParsedServerMessage;
        case 'WorkspaceData':
            return raw as ParsedServerMessage;
        default:
            return null;
    }
}
