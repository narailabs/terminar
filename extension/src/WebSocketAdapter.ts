import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import WebSocket from 'ws';

/**
 * Connection states for the WebSocket manager
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

const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
    baseDelay: 1000,
    maxDelay: 30000,
    maxRetries: 10,
    jitter: 500,
};

/**
 * Session information from server
 */
export interface SessionInfo {
    id: string;
    name: string;
    shell: string;
    started_at: string;
}

/**
 * Exchanges a pairing code for an auth token via HTTP
 * @param host - Server host (e.g., 'localhost:3000')
 * @param code - 6-digit pairing code
 * @returns Authentication token
 */
export async function exchangePairingCode(host: string, code: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = new URL(`http://${host}/pair/exchange`);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const postData = JSON.stringify({ code });

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                if (res.statusCode === 429) {
                    reject(new Error('Too many attempts. Please wait and try again.'));
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error('Invalid or expired pairing code'));
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    if (json.token) {
                        resolve(json.token);
                    } else {
                        reject(new Error('Unexpected response from server'));
                    }
                } catch {
                    reject(new Error('Failed to parse server response'));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`Connection failed: ${e.message}`));
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Connection timed out'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * WebSocket-based Session Manager for remote connections.
 * Mirrors the functionality of SessionManager but uses WebSocket instead of Unix socket.
 */
export class WebSocketSessionManager extends EventEmitter {
    private socket?: WebSocket;
    private authenticated = false;
    private state: ConnectionState = 'disconnected';
    private reconnectConfig: ReconnectConfig;
    private reconnectAttempt = 0;
    private reconnectTimer?: NodeJS.Timeout;
    private shouldReconnect = false;
    private lastSessionList: SessionInfo[] = [];

    constructor(
        private wsUrl: string,
        private token: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super();
        this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
    }

    public getState(): ConnectionState {
        return this.state;
    }

    public getLastSessionList(): SessionInfo[] {
        return this.lastSessionList;
    }

    private calculateReconnectDelay(): number {
        const { baseDelay, maxDelay, jitter } = this.reconnectConfig;
        const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempt), maxDelay);
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
        this.shouldReconnect = true;
        return this.doConnect();
    }

    private doConnect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

            try {
                this.socket = new WebSocket(this.wsUrl);
                this.authenticated = false;

                this.socket.on('open', () => {
                    // Send auth message as first message
                    this.sendInternal({ type: 'auth', token: this.token });

                    this.setState('connected');

                    const wasReconnect = this.reconnectAttempt > 0;
                    if (wasReconnect) {
                        this.emit('reconnected');
                        this.listSessions();
                    }

                    this.reconnectAttempt = 0;
                    resolve();
                });

                this.socket.on('error', (err: Error) => {
                    if (this.reconnectAttempt === 0) {
                        reject(err);
                    }
                    this.emit('error', err);
                });

                this.socket.on('message', (data: Buffer | string) => {
                    try {
                        const msg = JSON.parse(data.toString());
                        this.handleMessage(msg);
                    } catch (e) {
                        console.error('Failed to parse WebSocket message:', e);
                    }
                });

                this.socket.on('close', () => {
                    this.authenticated = false;
                    this.setState('disconnected');
                    this.emit('close');

                    if (this.shouldReconnect) {
                        this.scheduleReconnect();
                    }
                });
            } catch (err) {
                if (this.reconnectAttempt === 0) {
                    reject(err);
                }
            }
        });
    }

    private scheduleReconnect() {
        const { maxRetries } = this.reconnectConfig;

        if (maxRetries > 0 && this.reconnectAttempt >= maxRetries) {
            console.log('[WebSocket] Max reconnect attempts reached');
            this.emit('error', new Error(`Failed to reconnect after ${maxRetries} attempts`));
            return;
        }

        const delay = this.calculateReconnectDelay();
        this.reconnectAttempt++;

        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
        this.emit('reconnecting', this.reconnectAttempt, delay);

        this.reconnectTimer = setTimeout(() => {
            this.doConnect().catch(() => {
                // Error handling is done in doConnect
            });
        }, delay);
    }

    private handleMessage(msg: any) {
        if (msg.type === 'Error') {
            console.error('[WebSocket] Server error:', msg.message);
            this.emit('error', new Error(msg.message));
        } else if (msg.type === 'SessionList') {
            this.authenticated = true;
            this.lastSessionList = msg.sessions;
            this.emit('sessionList', msg.sessions);
        } else if (msg.type === 'Output') {
            this.emit('output', msg.session_id, msg.data);
        } else if (msg.type === 'SessionClosed') {
            this.emit('sessionClosed', msg.session_id);
        } else if (msg.type === 'Shutdown') {
            console.log('[WebSocket] Server shutting down:', msg.reason);
            this.emit('shutdown', msg.reason);
            this.reconnectAttempt = Math.max(this.reconnectAttempt, 2);
        }
    }

    public isConnected(): boolean {
        return this.state === 'connected';
    }

    public listSessions() {
        this.sendInternal({ type: 'list_sessions' });
    }

    public createSession(cwd: string, shell: string, env: Record<string, string>) {
        this.sendInternal({
            type: 'create_session',
            cwd,
            shell,
            env,
            cols: 80,
            rows: 24
        });
    }

    public attach(sessionId: string) {
        this.sendInternal({ type: 'attach', session_id: sessionId, mode: 'mirror' });
    }

    public sendInput(sessionId: string, data: string) {
        this.sendInternal({ type: 'input', session_id: sessionId, data });
    }

    public resize(sessionId: string, cols: number, rows: number) {
        this.sendInternal({ type: 'resize', session_id: sessionId, cols, rows });
    }

    public killSession(sessionId: string) {
        this.sendInternal({ type: 'kill_session', session_id: sessionId });
    }

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
    }

    public reconnect(): Promise<void> {
        this.disconnect();
        this.shouldReconnect = true;
        this.reconnectAttempt = 0;
        return this.connect();
    }

    private sendInternal(msg: any) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(msg));
        }
    }
}
