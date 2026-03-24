import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import WebSocket from 'ws';
import { BaseWebSocketManager, type IWebSocket, type ReconnectConfig } from '@narai/terminar-protocol';

/**
 * Exchanges a pairing code for an auth token via HTTP.
 * This is extension-specific (uses Node.js http module).
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

// Re-export types for backward compatibility
export type { ConnectionState, ReconnectConfig, SessionInfo } from '@narai/terminar-protocol';

/**
 * WebSocket-based Session Manager for remote connections (VS Code extension).
 * Uses Node.js `ws` library for WebSocket implementation.
 */
export class WebSocketSessionManager extends BaseWebSocketManager {
    constructor(
        wsUrl: string,
        token: string,
        reconnectConfig: Partial<ReconnectConfig> = {}
    ) {
        super(wsUrl, token, reconnectConfig);
    }

    protected createWebSocket(url: string): IWebSocket {
        return new WebSocket(url) as unknown as IWebSocket;
    }
}
