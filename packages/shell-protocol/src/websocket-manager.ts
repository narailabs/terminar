import { EventEmitter } from 'events';
import { parseServerMessage } from './parse.js';
import type { SessionInfo, ContainerInfo, SshConnectionInfo, SshConfigHost } from './messages.js';
import {
    type ConnectionState,
    type ReconnectConfig,
    DEFAULT_RECONNECT_CONFIG,
    calculateReconnectDelay,
} from './reconnect.js';
import type { TypedEventEmitter } from './typed-emitter.js';
import type { ActivityType } from './parse.js';

/**
 * Minimal WebSocket interface that works in both Node.js (ws) and browser.
 */
export interface IWebSocket {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(event: 'open', listener: () => void): void;
    addEventListener(event: 'message', listener: (event: { data: string | Buffer }) => void): void;
    addEventListener(event: 'close', listener: () => void): void;
    addEventListener(event: 'error', listener: (event: unknown) => void): void;
    removeEventListener(event: 'open', listener: () => void): void;
    removeEventListener(event: 'message', listener: (event: { data: string | Buffer }) => void): void;
    removeEventListener(event: 'close', listener: () => void): void;
    removeEventListener(event: 'error', listener: (event: unknown) => void): void;
}

/** WebSocket readyState constants */
export const WS_OPEN = 1;
export const WS_CONNECTING = 0;

/** Event map for BaseWebSocketManager */
export interface WebSocketManagerEvents {
    stateChange: [state: ConnectionState];
    reconnecting: [attempt: number, delay: number];
    reconnected: [];
    sessionList: [sessions: SessionInfo[]];
    output: [sessionId: string, data: string];
    sessionClosed: [sessionId: string];
    sessionActivity: [sessionId: string, activityType: ActivityType];
    sessionExited: [sessionId: string, exitCode: number | null];
    foregroundChanged: [sessionId: string, processName: string | null];
    cwdChanged: [sessionId: string, cwd: string];
    /**
     * Server parsed an OSC 52 clipboard write from the session's output.
     * Consumers should copy `data` to the user's local system clipboard.
     */
    clipboardWrite: [sessionId: string, data: string];
    /**
     * Server parsed an OSC 7777 `open_url` from the session's output.
     * Consumers should open `url` in the user's local default browser.
     */
    openUrl: [sessionId: string, url: string];
    workspaceData: [workspace: Record<string, unknown> | null];
    containerList: [containers: ContainerInfo[]];
    sshConnectionList: [connections: SshConnectionInfo[]];
    sshConfigImportResult: [hosts: SshConfigHost[]];
    /**
     * A server-originated error carrying both the user-facing message and an
     * optional machine-readable error_code (e.g., "DOCKER_UNAVAILABLE",
     * "SSH_CONNECTION_ERROR"). Consumers can route to scoped UI by code prefix.
     */
    serverError: [message: string, code: string | null];
    shutdown: [reason: string];
    authenticated: [token: string, expires: string];
    authChallenge: [nonce: string];
    error: [err: Error];
    close: [];
}

const TypedEmitter = EventEmitter as new () => TypedEventEmitter<WebSocketManagerEvents>;

/**
 * Abstract base class for WebSocket session managers.
 * Handles connection lifecycle, reconnection, message dispatch, and session operations.
 *
 * Subclasses must implement `createWebSocket(url)` to provide platform-specific WebSocket.
 */
export abstract class BaseWebSocketManager extends TypedEmitter {
    protected socket?: IWebSocket;
    protected authenticated = false;
    protected state: ConnectionState = 'disconnected';
    protected reconnectConfig: ReconnectConfig;
    protected reconnectAttempt = 0;
    protected reconnectTimer?: ReturnType<typeof setTimeout>;
    protected shouldReconnect = false;
    protected lastSessionList: SessionInfo[] = [];

    constructor(
        protected url: string,
        protected token?: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super();
        this.reconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, ...reconnectConfig };
    }

    /**
     * Create a platform-specific WebSocket instance.
     * Subclasses implement this for Node.js (ws) or browser (native WebSocket).
     */
    protected abstract createWebSocket(url: string): IWebSocket;

    public getState(): ConnectionState {
        return this.state;
    }

    public getLastSessionList(): SessionInfo[] {
        return this.lastSessionList;
    }

    public isAuthenticated(): boolean {
        return this.authenticated;
    }

    public isConnected(): boolean {
        return this.state === 'connected';
    }

    protected setState(newState: ConnectionState) {
        if (this.state !== newState) {
            this.state = newState;
            this.emit('stateChange', newState);
        }
    }

    public connect(): Promise<void> {
        if (this.socket && (this.socket.readyState === WS_OPEN || this.socket.readyState === WS_CONNECTING)) {
            return Promise.resolve();
        }
        this.shouldReconnect = true;
        return this.doConnect();
    }

    protected doConnect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
            this.socket = this.createWebSocket(this.url);
            this.authenticated = false;

            const onOpen = () => {
                if (this.token) {
                    this.sendRaw({ type: 'auth', token: this.token });
                }
                this.setState('connected');

                const wasReconnect = this.reconnectAttempt > 0;
                if (wasReconnect) {
                    this.emit('reconnected');
                    this.listSessions();
                }

                this.reconnectAttempt = 0;
                resolve();
            };

            const onError = (event: unknown) => {
                if (this.reconnectAttempt === 0) {
                    reject(event instanceof Error ? event : new Error('WebSocket connection failed'));
                }
                this.emit('error', event instanceof Error ? event : new Error('WebSocket error'));
            };

            const onMessage = (event: { data: string | Buffer }) => {
                try {
                    const raw = typeof event.data === 'string' ? event.data : event.data.toString();
                    const msg = JSON.parse(raw);
                    this.handleMessage(msg);
                } catch (e) {
                    console.error('Failed to parse WebSocket message:', e);
                }
            };

            const onClose = () => {
                this.authenticated = false;
                this.setState('disconnected');
                this.emit('close');

                this.socket?.removeEventListener('open', onOpen);
                this.socket?.removeEventListener('error', onError);
                this.socket?.removeEventListener('message', onMessage);
                this.socket?.removeEventListener('close', onClose);

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

    protected scheduleReconnect() {
        const { maxRetries } = this.reconnectConfig;

        if (maxRetries > 0 && this.reconnectAttempt >= maxRetries) {
            this.emit('error', new Error(`Failed to reconnect after ${maxRetries} attempts`));
            return;
        }

        const delay = calculateReconnectDelay(this.reconnectAttempt, this.reconnectConfig);
        this.reconnectAttempt++;

        this.emit('reconnecting', this.reconnectAttempt, delay);

        this.reconnectTimer = setTimeout(() => {
            this.doConnect().catch(() => {
                // Error handling done in doConnect
            });
        }, delay);
    }

    protected handleMessage(raw: unknown) {
        const parsed = parseServerMessage(raw);
        if (!parsed) {
            return;
        }

        switch (parsed.type) {
            case 'Error':
                // Legacy event carries just the Error object.
                this.emit('error', new Error(parsed.message));
                // New event also carries the error_code so consumers can route
                // to scoped UI (e.g., DOCKER_* → container store).
                this.emit('serverError', parsed.message, parsed.error_code ?? null);
                break;
            case 'AuthOk':
                this.authenticated = true;
                this.emit('authenticated', parsed.token, parsed.expires);
                break;
            case 'AuthChallenge':
                this.emit('authChallenge', parsed.nonce);
                break;
            case 'SessionList':
                this.authenticated = true;
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
            case 'ClipboardWrite':
                this.emit('clipboardWrite', parsed.session_id, parsed.data);
                break;
            case 'OpenUrl':
                this.emit('openUrl', parsed.session_id, parsed.url);
                break;
            case 'WorkspaceData':
                this.emit('workspaceData', parsed.workspace);
                break;
            case 'ContainerList':
                this.emit('containerList', parsed.containers);
                break;
            case 'SshConnectionList':
                this.emit('sshConnectionList', parsed.connections);
                break;
            case 'SshConfigImportResult':
                this.emit('sshConfigImportResult', parsed.hosts);
                break;
            case 'Shutdown':
                this.emit('shutdown', parsed.reason);
                this.reconnectAttempt = Math.max(this.reconnectAttempt, 2);
                break;
        }
    }

    // --- Session operations ---

    public listSessions() {
        this.sendRaw({ type: 'list_sessions' });
    }

    public createSession(
        cwd: string,
        shell: string,
        env: Record<string, string>,
        cols?: number,
        rows?: number,
        containerId?: string,
        sshConnectionId?: string,
    ) {
        const msg: Record<string, unknown> = {
            type: 'create_session',
            cwd,
            shell,
            env,
            cols: cols ?? 80,
            rows: rows ?? 24,
        };
        if (containerId) {
            msg.container_id = containerId;
        }
        if (sshConnectionId) {
            msg.ssh_connection_id = sshConnectionId;
        }
        this.sendRaw(msg);
    }

    public listContainers() {
        this.sendRaw({ type: 'list_containers' });
    }

    public listSshConnections() {
        this.sendRaw({ type: 'list_ssh_connections' });
    }

    public addSshConnection(name: string, host: string, user: string, port: number) {
        this.sendRaw({ type: 'add_ssh_connection', name, host, user, port });
    }

    public updateSshConnection(id: string, name: string, host: string, user: string, port: number) {
        this.sendRaw({ type: 'update_ssh_connection', id, name, host, user, port });
    }

    public removeSshConnection(id: string) {
        this.sendRaw({ type: 'remove_ssh_connection', id });
    }

    public importSshConfig() {
        this.sendRaw({ type: 'import_ssh_config' });
    }

    public attach(sessionId: string) {
        this.sendRaw({ type: 'attach', session_id: sessionId, mode: 'mirror' });
    }

    public sendInput(sessionId: string, data: string) {
        this.sendRaw({ type: 'input', session_id: sessionId, data });
    }

    public resize(sessionId: string, cols: number, rows: number) {
        this.sendRaw({ type: 'resize', session_id: sessionId, cols, rows });
    }

    public killSession(sessionId: string) {
        this.sendRaw({ type: 'kill_session', session_id: sessionId });
    }

    public renameSession(sessionId: string, newName: string) {
        this.sendRaw({ type: 'rename_session', session_id: sessionId, new_name: newName });
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
        this.setState('disconnected');
    }

    public reconnect(): Promise<void> {
        this.disconnect();
        this.shouldReconnect = true;
        this.reconnectAttempt = 0;
        return this.connect();
    }

    protected sendRaw(msg: Record<string, unknown>) {
        if (this.socket && this.socket.readyState === WS_OPEN) {
            this.socket.send(JSON.stringify(msg));
        }
    }
}
