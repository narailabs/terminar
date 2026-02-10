/**
 * Protocol message types for the termiNar WebSocket protocol.
 *
 * These types are now backed by the shared shell-protocol parse module.
 * This file maintains backward-compatible re-exports.
 */

export { parseServerMessage } from './shared-protocol';
export type { ParsedServerMessage as ServerMessage, ActivityType } from './shared-protocol';

// --- Session Info ---

export interface ProtocolSessionInfo {
    id: string;
    name: string;
    shell: string;
    cwd: string;
    started_at: string;
    foreground_process?: string | null;
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
