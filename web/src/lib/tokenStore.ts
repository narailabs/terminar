/**
 * Token persistence for WebSocket reconnection.
 *
 * Stores the auth token in localStorage so that when the page
 * is refreshed or the connection drops, the client can automatically
 * reconnect without requiring re-authentication.
 */

export const TOKEN_KEY = 'terminar-token';

/**
 * Save the auth token to localStorage.
 */
export function saveToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Load the auth token from localStorage.
 * Returns null if no token is stored.
 */
export function loadToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * Clear the stored auth token.
 */
export function clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
}
