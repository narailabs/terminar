import { EventEmitter } from 'events';
import type { ConnectionState } from './SessionManager';
import type { ClientMessage, ServerMessage } from './protocol-types';
import { parseServerMessage } from './protocol-types';

// Re-export ConnectionState for backwards compatibility
export type { ConnectionState } from './SessionManager';

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

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
    baseDelay: 1000,
    maxDelay: 30000,
    maxRetries: 10,
    jitter: 500,
};

/**
 * WebSocket Session Manager with token-in-first-message authentication
 * and automatic reconnection with exponential backoff.
 *
 * Security: Token is sent as the first message after connection, not in URL.
 * This prevents tokens from being logged in server access logs.
 *
 * Events:
 * - 'stateChange': (state: ConnectionState) - Connection state changed
 * - 'reconnecting': (attempt: number, delay: number) - Reconnection attempt starting
 * - 'reconnected': () - Successfully reconnected
 * - 'sessionList': (sessions: SessionInfo[]) - Session list received
 * - 'output': (sessionId: string, data: string) - Terminal output received
 * - 'shutdown': (reason: string) - Server is shutting down
 * - 'error': (error: Error) - Error occurred
 * - 'close': () - Connection closed
 */
export class WebSocketSessionManager extends EventEmitter {
    private socket?: WebSocket;
    private authenticated = false;
    private state: ConnectionState = 'disconnected';
    private reconnectConfig: ReconnectConfig;
    private reconnectAttempt = 0;
    private reconnectTimer?: ReturnType<typeof setTimeout>;
    private shouldReconnect = false;
    private lastSessionList: any[] = [];

    /**
     * Callback for SSH pubkey challenge-response signing.
     * When the server sends AuthChallenge, this callback is invoked
     * with the nonce to sign. It should return the base64-encoded signature.
     */
    private pubkeySignCallback?: (nonce: string) => Promise<string>;
    private pubkeyAlgorithm?: string;

    /**
     * @param url - WebSocket server URL (without token in query string)
     * @param token - Authentication token to send as first message
     * @param reconnectConfig - Optional reconnection configuration
     */
    // Handler for page unload - ensures clean WebSocket closure on refresh/navigation
    private boundBeforeUnloadHandler: (() => void) | null = null;

    // JWT token received from AuthOk (for reconnection)
    private jwtToken?: string;

    constructor(
        private url: string,
        private token?: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super();
        this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
        console.log('[WS] Manager created for', url);

        // Register beforeunload handler to cleanly close WebSocket on page refresh/navigation
        // This prevents "zombie" connections that keep forwarding output after refresh
        if (typeof window !== 'undefined') {
            this.boundBeforeUnloadHandler = () => {
                console.log('[WS] Page unloading, closing WebSocket');
                this.shouldReconnect = false; // Don't try to reconnect during unload
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    // Send close frame to server for clean shutdown
                    this.socket.close(1000, 'Page unloading');
                }
            };
            window.addEventListener('beforeunload', this.boundBeforeUnloadHandler);
        }
    }

    /**
     * Get the current connection state
     */
    public getState(): ConnectionState {
        return this.state;
    }

    /**
     * Get the last received session list (preserved across reconnects)
     */
    public getLastSessionList(): any[] {
        return this.lastSessionList;
    }

    /**
     * Calculate reconnection delay with exponential backoff and jitter
     */
    private calculateReconnectDelay(): number {
        const { baseDelay, maxDelay, jitter } = this.reconnectConfig;
        // Exponential backoff: baseDelay * 2^attempt
        const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt), maxDelay);
        // Add random jitter (0 to jitter ms)
        const jitterMs = Math.random() * jitter;
        return Math.floor(exponentialDelay + jitterMs);
    }

    private setState(newState: ConnectionState) {
        if (this.state !== newState) {
            this.state = newState;
            this.emit('stateChange', newState);
        }
    }

    public connect(): Promise<void> {
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            console.log('[WS] Already connected or connecting');
            return Promise.resolve();
        }

        this.shouldReconnect = true;
        return this.doConnect();
    }

    private doConnect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
            this.socket = new WebSocket(this.url);
            this.authenticated = false;

            const onOpen = () => {
                // Send Auth message as first message (security: token not in URL)
                if (this.token) {
                    console.log('[WS] Sending authentication message');
                    this.sendInternal({ type: 'auth', token: this.token });
                }

                this.setState('connected');

                const wasReconnect = this.reconnectAttempt > 0;
                if (wasReconnect) {
                    console.log('[WS] Reconnected successfully');
                    this.emit('reconnected');
                    // Request session list only after reconnection (not initial connection)
                    this.listSessions();
                }

                this.reconnectAttempt = 0;
                resolve();
            };

            const onError = (err: Event) => {
                if (this.reconnectAttempt === 0) {
                    reject(err);
                }
            };

            const onMessage = (event: MessageEvent) => {
                try {
                    const msg = JSON.parse(event.data);
                    this.handleMessage(msg);
                } catch (e) {
                    console.error('Failed to parse message', e);
                }
            };

            const onClose = () => {
                this.authenticated = false;
                this.setState('disconnected');
                this.emit('close');

                // Clean up listeners
                this.socket?.removeEventListener('open', onOpen);
                this.socket?.removeEventListener('error', onError);
                this.socket?.removeEventListener('message', onMessage);
                this.socket?.removeEventListener('close', onClose);

                // Attempt reconnection if enabled
                if (this.shouldReconnect) {
                    this.scheduleReconnect();
                }
            };

            this.socket.addEventListener('open', onOpen);
            this.socket.addEventListener('error', onError);
            this.socket.addEventListener('message', onMessage);
            this.socket.addEventListener('close', onClose);
        });
    }

    private scheduleReconnect() {
        const { maxRetries } = this.reconnectConfig;

        // Check if max retries exceeded (0 = infinite)
        if (maxRetries > 0 && this.reconnectAttempt >= maxRetries) {
            console.log('[WS] Max reconnect attempts reached');
            this.emit('error', new Error(`Failed to reconnect after ${maxRetries} attempts`));
            return;
        }

        const delay = this.calculateReconnectDelay();
        this.reconnectAttempt++;

        console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
        this.emit('reconnecting', this.reconnectAttempt, delay);

        this.reconnectTimer = setTimeout(() => {
            this.doConnect().catch(() => {
                // Error handling is done in doConnect
            });
        }, delay);
    }

    private handleMessage(msg: unknown) {
        const parsed = parseServerMessage(msg);
        if (!parsed) {
            console.warn('[WS] Ignoring invalid/unknown message:', msg);
            return;
        }

        switch (parsed.type) {
            case 'Error':
                console.error('[WS] Server error:', parsed.message);
                this.emit('error', new Error(parsed.message));
                break;
            case 'AuthOk':
                console.log('[WS] Authenticated successfully');
                this.authenticated = true;
                this.jwtToken = parsed.token;
                this.emit('authenticated', parsed.token, parsed.expires);
                break;
            case 'AuthChallenge':
                console.log('[WS] Received auth challenge');
                if (this.pubkeySignCallback) {
                    this.pubkeySignCallback(parsed.nonce)
                        .then((signature) => {
                            this.sendInternal({
                                type: 'auth_pubkey_verify',
                                signature,
                                algorithm: this.pubkeyAlgorithm || 'ssh-ed25519',
                            });
                        })
                        .catch((err) => {
                            console.error('[WS] Failed to sign challenge:', err);
                            this.emit('error', new Error('Failed to sign authentication challenge'));
                        });
                }
                break;
            case 'SessionList':
                this.authenticated = true;  // Got a real response, we're authenticated
                this.lastSessionList = parsed.sessions;
                this.emit('sessionList', parsed.sessions);
                break;
            case 'Output':
                this.emit('output', parsed.session_id, parsed.data);
                break;
            case 'SessionClosed':
                this.emit('sessionClosed', parsed.session_id);
                break;
            case 'SessionActivity':
                this.emit('sessionActivity', parsed.session_id, parsed.activity_type);
                break;
            case 'SessionExited':
                this.emit('sessionExited', parsed.session_id, parsed.exit_code);
                break;
            case 'ForegroundChanged':
                this.emit('foregroundChanged', parsed.session_id, parsed.process_name);
                break;
            case 'CwdChanged':
                this.emit('cwdChanged', parsed.session_id, parsed.cwd);
                break;
            case 'Shutdown':
                console.log('[WS] Server shutting down:', parsed.reason);
                this.emit('shutdown', parsed.reason);
                // Don't try to reconnect during server shutdown
                // Wait a bit longer before reconnecting
                this.reconnectAttempt = Math.max(this.reconnectAttempt, 2);
                break;
        }
    }

    public isAuthenticated(): boolean {
        return this.authenticated;
    }

    public isConnected(): boolean {
        return this.state === 'connected';
    }

    public listSessions() {
        this.sendInternal({ type: 'list_sessions' });
    }

    public createSession(cwd: string, shell: string, env: any, cols?: number, rows?: number) {
        this.sendInternal({
            type: 'create_session',
            cwd,
            shell,
            env,
            cols: cols ?? 80,
            rows: rows ?? 24
        });
    }

    public attach(sessionId: string) {
        this.sendInternal({ type: 'attach', session_id: sessionId, mode: 'mirror' });
    }

    public sendInput(sessionId: string, data: string) {
        this.sendInternal({ type: 'input', session_id: sessionId, data });
    }

    public renameSession(sessionId: string, newName: string) {
        this.sendInternal({ type: 'rename_session', session_id: sessionId, new_name: newName });
    }

    public killSession(sessionId: string) {
        this.sendInternal({ type: 'kill_session', session_id: sessionId });
    }

    public resize(sessionId: string, cols: number, rows: number) {
        this.sendInternal({ type: 'resize', session_id: sessionId, cols, rows });
    }

    /**
     * Disconnect and disable automatic reconnection
     */
    public disconnect() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
        this.reconnectAttempt = 0;
        if (this.socket) {
            this.socket.close();
        }
        this.setState('disconnected');
        // Clean up beforeunload handler to prevent memory leaks
        if (typeof window !== 'undefined' && this.boundBeforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.boundBeforeUnloadHandler);
            this.boundBeforeUnloadHandler = null;
        }
    }

    /**
     * Manually trigger a reconnection attempt
     */
    public reconnect(): Promise<void> {
        this.disconnect();
        this.shouldReconnect = true;
        this.reconnectAttempt = 0;
        return this.connect();
    }

    /**
     * Authenticate with username and password (PAM).
     * The server will respond with AuthOk or Error.
     */
    public authenticateWithPassword(username: string, password: string) {
        this.sendInternal({ type: 'auth_password', username, password });
    }

    /**
     * Authenticate with a JWT token (reconnection).
     * The server will respond with AuthOk or Error.
     */
    public authenticateWithToken(token: string) {
        this.sendInternal({ type: 'auth_token', token });
    }

    /**
     * Initiate SSH public key authentication.
     * The server will respond with AuthChallenge containing a nonce to sign.
     * @param signCallback - Called with the nonce; should return base64-encoded signature
     */
    public authenticateWithPubkey(
        username: string,
        pubkey: string,
        algorithm: string,
        signCallback: (nonce: string) => Promise<string>,
    ) {
        this.pubkeySignCallback = signCallback;
        this.pubkeyAlgorithm = algorithm;
        this.sendInternal({ type: 'auth_pubkey_init', username, pubkey });
    }

    /**
     * Get the JWT token received from successful authentication.
     */
    public getJwtToken(): string | undefined {
        return this.jwtToken;
    }

    private sendInternal(msg: ClientMessage) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(msg));
        }
    }
}
