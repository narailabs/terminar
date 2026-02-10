/**
 * Connection states for WebSocket managers
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Reconnection configuration
 */
export interface ReconnectConfig {
    /** Base delay in ms (default: 1000) */
    baseDelay: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelay: number;
    /** Maximum retry attempts (default: 10, 0 = infinite) */
    maxRetries: number;
    /** Maximum jitter in ms to add randomness (default: 500) */
    jitter: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
    baseDelay: 1000,
    maxDelay: 30000,
    maxRetries: 10,
    jitter: 500,
};

/**
 * Calculate reconnection delay with exponential backoff and jitter.
 */
export function calculateReconnectDelay(attempt: number, config: ReconnectConfig): number {
    const { baseDelay, maxDelay, jitter } = config;
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitterMs = Math.random() * jitter;
    return Math.floor(exponentialDelay + jitterMs);
}
