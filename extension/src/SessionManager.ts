import * as net from 'net';
import { EventEmitter } from 'events';
import { ShellClient } from '@narai/terminar-protocol/dist/client';
import type { ConnectionState, ReconnectConfig } from '@narai/terminar-protocol/dist/reconnect';
import { DEFAULT_RECONNECT_CONFIG } from '@narai/terminar-protocol/dist/reconnect';
import type { SessionInfo } from '@narai/terminar-protocol/dist/messages';
import type { TypedEventEmitter } from '@narai/terminar-protocol/dist/typed-emitter';
import { NetSocketAdapter } from './NetSocketAdapter';

// Re-export types for downstream consumers
export type { ConnectionState, ReconnectConfig, SessionInfo };

/** Event map for the extension's SessionManager */
export interface SessionManagerEvents {
    stateChange: [state: ConnectionState];
    reconnecting: [attempt: number, delay: number];
    reconnected: [];
    sessionList: [sessions: SessionInfo[]];
    output: [sessionId: string, data: string];
    sessionClosed: [sessionId: string];
    shutdown: [reason: string];
    error: [err: Error];
    close: [];
}

/**
 * Session Manager with automatic reconnection and exponential backoff.
 *
 * Events:
 * - 'stateChange': (state: ConnectionState) - Connection state changed
 * - 'reconnecting': (attempt: number, delay: number) - Reconnection attempt starting
 * - 'reconnected': () - Successfully reconnected
 * - 'sessionList': (sessions: SessionInfo[]) - Session list received
 * - 'output': (sessionId: string, data: string) - Terminal output received
 * - 'sessionClosed': (sessionId: string) - Session was closed
 * - 'shutdown': (reason: string) - Server is shutting down
 * - 'error': (error: Error) - Error occurred
 * - 'close': () - Connection closed
 */
const TypedEmitter = EventEmitter as new () => TypedEventEmitter<SessionManagerEvents>;

export class SessionManager extends TypedEmitter {
    private client?: ShellClient;
    private socket?: net.Socket;
    private state: ConnectionState = 'disconnected';
    private reconnectConfig: ReconnectConfig;
    private reconnectAttempt = 0;
    private reconnectTimer?: NodeJS.Timeout;
    private shouldReconnect = false;
    private lastSessionList: SessionInfo[] = [];

    constructor(
        private socketPath: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super();
        this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
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
    public getLastSessionList(): SessionInfo[] {
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

    private setupClient() {
        this.client = new ShellClient();

        this.client.on('SessionList', (msg) => {
            this.lastSessionList = msg.sessions;
            this.emit('sessionList', msg.sessions);
        });

        this.client.on('Output', (msg) => {
            this.emit('output', msg.session_id, msg.data);
        });

        this.client.on('SessionClosed', (msg) => {
            this.emit('sessionClosed', msg.session_id);
        });

        this.client.on('Shutdown', (msg) => {
            console.log('[SessionManager] Server shutting down:', msg.reason);
            this.emit('shutdown', msg.reason);
            // Wait a bit longer before reconnecting after server shutdown
            this.reconnectAttempt = Math.max(this.reconnectAttempt, 2);
        });

        this.client.on('error', (err) => {
            this.emit('error', err);
        });

        this.client.on('close', () => {
            this.setState('disconnected');
            this.emit('close');

            // Attempt reconnection if enabled
            if (this.shouldReconnect) {
                this.scheduleReconnect();
            }
        });
    }

    public connect(): Promise<void> {
        this.shouldReconnect = true;
        return this.doConnect();
    }

    private doConnect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

            try {
                // Create fresh client for each connection
                this.setupClient();

                this.socket = net.createConnection(this.socketPath);
                const adapter = new NetSocketAdapter(this.socket);

                // Connect client to adapter BEFORE socket connects, so the
                // client is already listening when the adapter emits 'open'.
                if (this.client) {
                    this.client.connect(adapter);
                }

                // Prevent uncaught error from the adapter.
                adapter.on('error', (err) => {
                    this.emit('error', err);
                });

                this.socket.on('connect', () => {
                    this.setState('connected');

                    const wasReconnect = this.reconnectAttempt > 0;
                    if (wasReconnect) {
                        console.log('[SessionManager] Reconnected successfully');
                        this.emit('reconnected');
                        // Request session list only after reconnection (not initial connection)
                        this.listSessions();
                    }

                    this.reconnectAttempt = 0;
                    resolve();
                });

                this.socket.on('error', (err) => {
                    if (this.reconnectAttempt === 0) {
                        // On initial connect failure, disable reconnection so we
                        // don't spawn background retries after rejecting the promise.
                        this.shouldReconnect = false;
                        reject(err);
                    }
                    // Socket errors will trigger close event, which handles reconnection
                });

                this.socket.on('close', () => {
                    // Already handled in client close event
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

        // Check if max retries exceeded (0 = infinite)
        if (maxRetries > 0 && this.reconnectAttempt >= maxRetries) {
            console.log('[SessionManager] Max reconnect attempts reached');
            this.emit('error', new Error(`Failed to reconnect after ${maxRetries} attempts`));
            return;
        }

        const delay = this.calculateReconnectDelay();
        this.reconnectAttempt++;

        console.log(`[SessionManager] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
        this.emit('reconnecting', this.reconnectAttempt, delay);

        this.reconnectTimer = setTimeout(() => {
            this.doConnect().catch(() => {
                // Error handling is done in doConnect
            });
        }, delay);
    }

    public isConnected(): boolean {
        return this.state === 'connected';
    }

    public listSessions() {
        this.client?.send({ type: 'list_sessions' });
    }

    public createSession(cwd: string, shell: string, env: Record<string, string>, cols?: number, rows?: number) {
        this.client?.send({
            type: 'create_session',
            cwd,
            shell,
            env,
            cols: cols ?? 120,
            rows: rows ?? 30
        });
    }

    public attach(sessionId: string) {
        this.client?.send({ type: 'attach', session_id: sessionId, mode: 'mirror' });
    }

    public sendInput(sessionId: string, data: string) {
        this.client?.send({ type: 'input', session_id: sessionId, data });
    }

    public resize(sessionId: string, cols: number, rows: number) {
        this.client?.send({ type: 'resize', session_id: sessionId, cols, rows });
    }

    public killSession(sessionId: string) {
        this.client?.send({ type: 'kill_session', session_id: sessionId });
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
        this.client?.close();
        if (this.socket) {
            this.socket.destroy();
        }
        this.setState('disconnected');
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
}
