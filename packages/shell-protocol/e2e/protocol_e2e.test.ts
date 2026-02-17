import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as cp from 'child_process';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import { IShellSocket } from '../src/client';
import { ServerMessageSchema } from '../src/messages';
import { EventEmitter } from 'events';

/**
 * Length-prefixed socket adapter for testing.
 * Frame format: 4-byte big-endian length + JSON payload.
 * Mirrors the NetSocketAdapter used by the VS Code extension.
 */
class LengthPrefixedSocketAdapter extends EventEmitter implements IShellSocket {
    private buffer: Buffer = Buffer.alloc(0);

    constructor(private socket: net.Socket) {
        super();
        this.socket.on('data', (data: Buffer) => {
            this.buffer = Buffer.concat([this.buffer, data]);
            this.parseFrames();
        });
        this.socket.on('connect', () => this.emit('open'));
        this.socket.on('close', () => this.emit('close'));
        this.socket.on('error', (err) => this.emit('error', err));
    }

    private parseFrames(): void {
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            if (this.buffer.length < 4 + length) break;
            const json = this.buffer.subarray(4, 4 + length).toString('utf-8');
            this.buffer = this.buffer.subarray(4 + length);
            if (json.trim()) this.emit('message', json);
        }
    }

    send(data: string): void {
        const payload = Buffer.from(data, 'utf-8');
        const header = Buffer.alloc(4);
        header.writeUInt32BE(payload.length, 0);
        this.socket.write(Buffer.concat([header, payload]));
    }

    close(): void {
        this.socket.destroy();
    }
}

/**
 * Resolve the server binary path. Checks (in order):
 * 1. SHELL_SERVER_BIN environment variable
 * 2. Release build at ../../server/target/release/terminar-server
 * 3. Debug build at ../../server/target/debug/terminar-server
 *
 * Returns the path if found, or null if no binary exists.
 */
function resolveServerBin(): string | null {
    if (process.env.SHELL_SERVER_BIN) {
        const envPath = path.resolve(process.env.SHELL_SERVER_BIN);
        if (fs.existsSync(envPath)) return envPath;
    }

    // Relative to this test file: e2e/ -> terminar-protocol/ -> packages/ -> terminar/server/
    const serverDir = path.resolve(__dirname, '../../../server/target');

    const releaseBin = path.join(serverDir, 'release', 'terminar-server');
    if (fs.existsSync(releaseBin)) return releaseBin;

    const debugBin = path.join(serverDir, 'debug', 'terminar-server');
    if (fs.existsSync(debugBin)) return debugBin;

    return null;
}

const serverBin = resolveServerBin();
const skipReason = serverBin
    ? undefined
    : 'Server binary not found. Build with `cargo build --release` in server/ or set SHELL_SERVER_BIN env var.';

describe.skipIf(!!skipReason)('Shell Protocol E2E', () => {
    let serverProcess: cp.ChildProcess;
    const socketPath = '/tmp/test-protocol-e2e.sock';

    beforeAll(async () => {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

        // Use a random high port to avoid conflicts with any running server on the default port 6749
        const testPort = String(49152 + Math.floor(Math.random() * 16383));
        serverProcess = cp.spawn(serverBin!, ['--socket', socketPath, '--port', testPort, '--no-auth', '--mock-pty'], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Forward server output for debugging
        serverProcess.stderr?.on('data', (data) => {
            if (process.env.DEBUG_E2E) process.stderr.write(`[server] ${data}`);
        });

        // Wait for socket
        await new Promise<void>((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (fs.existsSync(socketPath)) resolve();
                else if (Date.now() - start > 5000) reject(new Error('Timeout waiting for server'));
                else setTimeout(check, 100);
            };
            check();
        });
    });

    afterAll(() => {
        if (serverProcess) serverProcess.kill();
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    });

    it('should connect, create session, and exchange data', async () => {
        const socket = net.createConnection(socketPath);
        const adapter = new LengthPrefixedSocketAdapter(socket);

        // Wait for connection
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Connect timeout')), 5000);
            adapter.on('open', () => { clearTimeout(timeout); resolve(); });
            adapter.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
        });

        // Helper to parse server messages
        const serverMessages: any[] = [];
        adapter.on('message', (data: string) => {
            try {
                const parsed = ServerMessageSchema.safeParse(JSON.parse(data));
                if (parsed.success) serverMessages.push(parsed.data);
            } catch { /* ignore parse errors */ }
        });

        // Note: Unix socket connections skip authentication (handled at WebSocket layer).
        // We send messages directly via the adapter using length-prefixed framing.

        // 1. Create Session
        const sessionListPromise = new Promise<any[]>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('SessionList timeout')), 5000);
            const handler = (data: string) => {
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === 'SessionList' && msg.sessions?.length > 0) {
                        clearTimeout(timeout);
                        adapter.removeListener('message', handler);
                        resolve(msg.sessions);
                    }
                } catch { /* ignore */ }
            };
            adapter.on('message', handler);
        });

        adapter.send(JSON.stringify({
            type: 'create_session',
            cwd: '/tmp',
            shell: process.env.SHELL || '/bin/bash',
            env: {},
            cols: 80,
            rows: 24
        }));

        const sessionList = await sessionListPromise;

        expect(sessionList.length).toBeGreaterThan(0);
        const sessionId = sessionList[0].id;

        // 2. Attach
        adapter.send(JSON.stringify({ type: 'attach', session_id: sessionId, mode: 'mirror' }));

        // 3. Send Input & Verify Output
        const outputPromise = new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Output timeout')), 5000);
            const handler = (data: string) => {
                try {
                    const msg = JSON.parse(data);
                    if (msg.type === 'Output' && msg.session_id === sessionId && msg.data?.includes('Protocol-E2E')) {
                        clearTimeout(timeout);
                        adapter.removeListener('message', handler);
                        resolve(msg.data);
                    }
                } catch { /* ignore */ }
            };
            adapter.on('message', handler);
        });

        adapter.send(JSON.stringify({ type: 'input', session_id: sessionId, data: 'echo Protocol-E2E\n' }));

        const output = await outputPromise;
        expect(output).toContain('Protocol-E2E');

        adapter.close();
    }, 15000);
});
