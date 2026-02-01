/**
 * Protocol message types for the termiNar WebSocket protocol.
 *
 * These types mirror the definitions in @narai/terminar-protocol (packages/terminar-protocol).
 * They provide type-safe message handling without requiring a runtime dependency on zod.
 *
 * If the terminar-protocol schema changes, update these types to match.
 */

// --- Session Info ---

export interface ProtocolSessionInfo {
    id: string;
    name: string;
    shell: string;
    started_at: string;
}

// --- Client Messages (sent to server) ---

export type ClientMessage =
    | { type: 'auth'; token: string }
    | { type: 'auth_password'; username: string; password: string }
    | { type: 'auth_token'; token: string }
    | { type: 'auth_pubkey_init'; username: string; pubkey: string }
    | { type: 'auth_pubkey_verify'; signature: string; algorithm: string }
    | { type: 'list_sessions' }
    | { type: 'create_session'; cwd: string; shell: string; env: Record<string, string>; cols: number; rows: number }
    | { type: 'attach'; session_id: string; mode: string }
    | { type: 'input'; session_id: string; data: string }
    | { type: 'resize'; session_id: string; cols: number; rows: number }
    | { type: 'rename_session'; session_id: string; new_name: string }
    | { type: 'kill_session'; session_id: string };

// --- Server Messages (received from server) ---

export type ServerMessage =
    | { type: 'SessionList'; sessions: ProtocolSessionInfo[] }
    | { type: 'Output'; session_id: string; data: string }
    | { type: 'SessionClosed'; session_id: string }
    | { type: 'Error'; message: string }
    | { type: 'Shutdown'; reason: string }
    | { type: 'AuthOk'; token: string; expires: string }
    | { type: 'AuthChallenge'; nonce: string };

/** All valid server message type strings */
const VALID_SERVER_TYPES = new Set<string>([
    'SessionList', 'Output', 'SessionClosed', 'Error', 'Shutdown',
    'AuthOk', 'AuthChallenge',
]);

/**
 * Parse and validate a raw object as a ServerMessage.
 * Returns the typed message if valid, or null if the message is
 * unknown, malformed, or null.
 *
 * This replaces the zod-based validation from shell-protocol with
 * a lightweight runtime check suitable for the browser.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
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
            return raw as ServerMessage;
        case 'Output':
            if (typeof msg.session_id !== 'string' || typeof msg.data !== 'string') return null;
            return raw as ServerMessage;
        case 'SessionClosed':
            if (typeof msg.session_id !== 'string') return null;
            return raw as ServerMessage;
        case 'Error':
            if (typeof msg.message !== 'string') return null;
            return raw as ServerMessage;
        case 'Shutdown':
            if (typeof msg.reason !== 'string') return null;
            return raw as ServerMessage;
        case 'AuthOk':
            if (typeof msg.token !== 'string' || typeof msg.expires !== 'string') return null;
            return raw as ServerMessage;
        case 'AuthChallenge':
            if (typeof msg.nonce !== 'string') return null;
            return raw as ServerMessage;
        default:
            return null;
    }
}
