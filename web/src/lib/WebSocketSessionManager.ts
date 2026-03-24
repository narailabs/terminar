import { BaseWebSocketManager, type IWebSocket, type ReconnectConfig } from './shared-protocol';
import type { ClientMessage } from './protocol-types';

// Re-export ConnectionState for backwards compatibility
export type { ConnectionState } from './shared-protocol';
export type { ReconnectConfig } from './shared-protocol';

/**
 * WebSocket Session Manager for the web frontend.
 * Uses the browser's native WebSocket and adds auth methods + beforeunload handling.
 */
export class WebSocketSessionManager extends BaseWebSocketManager {
    private pubkeySignCallback?: (nonce: string) => Promise<string>;
    private pubkeyAlgorithm?: string;
    private boundBeforeUnloadHandler: (() => void) | null = null;
    private jwtToken?: string;

    constructor(
        url: string,
        token?: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super(url, token, reconnectConfig);

        // Register beforeunload handler to cleanly close WebSocket on page refresh/navigation
        if (typeof window !== 'undefined') {
            this.boundBeforeUnloadHandler = () => {
                this.shouldReconnect = false;
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.close(1000, 'Page unloading');
                }
            };
            window.addEventListener('beforeunload', this.boundBeforeUnloadHandler);
        }
    }

    protected createWebSocket(url: string): IWebSocket {
        return new WebSocket(url) as unknown as IWebSocket;
    }

    protected handleMessage(raw: unknown) {
        // Let base handle everything, but capture JWT and auth challenge
        const msg = raw as Record<string, unknown>;

        if (msg?.type === 'AuthOk' && typeof msg.token === 'string') {
            this.jwtToken = msg.token;
        }

        if (msg?.type === 'AuthChallenge' && typeof msg.nonce === 'string' && this.pubkeySignCallback) {
            this.pubkeySignCallback(msg.nonce)
                .then((signature) => {
                    this.sendRaw({
                        type: 'auth_pubkey_verify',
                        signature,
                        algorithm: this.pubkeyAlgorithm || 'ssh-ed25519',
                    });
                })
                .catch((err) => {
                    this.emit('error', new Error('Failed to sign authentication challenge'));
                });
            // Still let base class handle the message for event emission
        }

        super.handleMessage(raw);
    }

    public disconnect() {
        super.disconnect();
        if (typeof window !== 'undefined' && this.boundBeforeUnloadHandler) {
            window.removeEventListener('beforeunload', this.boundBeforeUnloadHandler);
            this.boundBeforeUnloadHandler = null;
        }
    }

    /** Authenticate with username and password (PAM). */
    public authenticateWithPassword(username: string, password: string) {
        this.sendRaw({ type: 'auth_password', username, password });
    }

    /** Authenticate with a JWT token (reconnection). */
    public authenticateWithToken(token: string) {
        this.sendRaw({ type: 'auth_token', token });
    }

    /** Initiate SSH public key authentication. */
    public authenticateWithPubkey(
        username: string,
        pubkey: string,
        algorithm: string,
        signCallback: (nonce: string) => Promise<string>,
    ) {
        this.pubkeySignCallback = signCallback;
        this.pubkeyAlgorithm = algorithm;
        this.sendRaw({ type: 'auth_pubkey_init', username, pubkey });
    }

    /** Get the JWT token received from successful authentication. */
    public getJwtToken(): string | undefined {
        return this.jwtToken;
    }
}
