import * as assert from 'assert';
import * as net from 'net';
import * as fs from 'fs';
import { SessionManager } from '../SessionManager';

/**
 * Helper to create a length-prefixed frame from a JSON object or string.
 * Frame format: 4-byte big-endian uint32 length + payload bytes.
 */
function createFrame(payload: string | object): Buffer {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const payloadBuf = Buffer.from(str, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payloadBuf.length, 0);
    return Buffer.concat([header, payloadBuf]);
}

/**
 * Parse length-prefixed frames from a buffer.
 * Returns array of parsed JSON objects and any remaining buffer.
 */
function parseFrames(buffer: Buffer): { messages: any[]; remaining: Buffer } {
    const messages: any[] = [];
    let offset = 0;
    while (offset + 4 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        if (offset + 4 + length > buffer.length) break;
        const json = buffer.subarray(offset + 4, offset + 4 + length).toString('utf-8');
        if (json.trim()) {
            messages.push(JSON.parse(json));
        }
        offset += 4 + length;
    }
    return { messages, remaining: buffer.subarray(offset) };
}

const TEST_TOKEN = 'test-token-12345';

suite('SessionManager', () => {
    const socketPath = '/tmp/test-vscode-terminar.sock';
    let mockServer: net.Server;
    let receivedMessages: any[] = [];
    let activeSocket: net.Socket | null = null;
    let manager: SessionManager;

    setup((done) => {
        receivedMessages = [];
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

        mockServer = net.createServer((socket) => {
            activeSocket = socket;
            let buffer: Buffer = Buffer.alloc(0);

            socket.on('data', (data: Buffer) => {
                buffer = Buffer.concat([buffer, data]);
                const { messages, remaining } = parseFrames(buffer);
                buffer = remaining;

                for (const msg of messages) {
                    // Handle auth message by responding with AuthOk
                    if (msg.type === 'auth') {
                        socket.write(createFrame({ type: 'AuthOk', token: 'jwt-test', expires: '2099-01-01T00:00:00Z' }));
                        continue;
                    }

                    receivedMessages.push(msg);

                    if (msg.type === 'list_sessions') {
                        socket.write(createFrame({
                            type: 'SessionList',
                            sessions: [{ id: '1', shell: 'bash', name: 'test', cwd: '/tmp', started_at: 'now' }]
                        }));
                    }
                }
            });
        });

        mockServer.listen(socketPath, () => {
            manager = new SessionManager(socketPath, TEST_TOKEN);
            done();
        });
    });

    teardown((done) => {
        if (manager) manager.disconnect();
        if (activeSocket) activeSocket.destroy();

        mockServer.close(() => {
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
            done();
        });
    });

    test('connects and receives session list', async () => {
        const listPromise = new Promise<any[]>((resolve) => {
            manager.on('sessionList', (sessions) => resolve(sessions));
        });

        await manager.connect();
        manager.listSessions();

        const sessions = await listPromise;
        assert.strictEqual(sessions.length, 1);
        assert.strictEqual(sessions[0].id, '1');
    });

    test('sends create_session', async () => {
        await manager.connect();

        // Wait for auth to complete
        await new Promise(r => setTimeout(r, 100));

        manager.createSession('/tmp', 'bash', {});

        // Wait for socket I/O
        await new Promise(r => setTimeout(r, 100));

        const msg = receivedMessages.find(m => m.type === 'create_session');
        assert.ok(msg, 'Should have received create_session message');
        assert.strictEqual(msg.shell, 'bash');
    });

    test('sends attach', async () => {
        await manager.connect();
        await new Promise(r => setTimeout(r, 100));

        manager.attach('123');

        await new Promise(r => setTimeout(r, 100));
        const msg = receivedMessages.find(m => m.type === 'attach');
        assert.ok(msg, 'Should have received attach message');
        assert.strictEqual(msg.session_id, '123');
    });

    test('sends input', async () => {
        await manager.connect();
        await new Promise(r => setTimeout(r, 100));

        manager.sendInput('123', 'ls');

        await new Promise(r => setTimeout(r, 100));
        const msg = receivedMessages.find(m => m.type === 'input');
        assert.ok(msg, 'Should have received input message');
        assert.strictEqual(msg.data, 'ls');
    });

    test('sends kill_session', async () => {
        await manager.connect();
        await new Promise(r => setTimeout(r, 100));

        manager.killSession('123');

        await new Promise(r => setTimeout(r, 100));
        const msg = receivedMessages.find(m => m.type === 'kill_session');
        assert.ok(msg, 'Should have received kill_session message');
        assert.strictEqual(msg.session_id, '123');
    });
});
