/**
 * Server message parsing using Zod schemas as the single source of truth.
 * Replaces the manual validation that previously duplicated schema logic.
 */

import { ServerMessageSchema, type ServerMessage } from './messages.js';

/** Activity types that appear in SessionActivity messages */
export type ActivityType = 'activity' | 'bell' | 'silence';

/** Parsed server message — derived from the Zod ServerMessage schema */
export type ParsedServerMessage = ServerMessage;

/**
 * Parse and validate a raw object as a server message.
 * Returns the typed message if valid, or null if unknown/malformed.
 */
export function parseServerMessage(raw: unknown): ParsedServerMessage | null {
    const result = ServerMessageSchema.safeParse(raw);
    if (result.success) {
        return result.data;
    }
    return null;
}
