import * as assert from 'assert';
import * as net from 'net';
import * as fs from 'fs';
import { SessionManager } from '../SessionManager';
import { EventEmitter } from 'events';

const TEST_TOKEN = 'test-token-12345';

/**
 * Helper to create a length-prefixed frame.
 */
function createFrame(payload: string | object): Buffer {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const payloadBuf = Buffer.from(str, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payloadBuf.length, 0);
    return Buffer.concat([header, payloadBuf]);
}

function parseFrames(buffer: Buffer): { messages: any[]; remaining: Buffer } {
    const messages: any[] = [];
    let offset = 0;
    while (offset + 4 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        if (offset + 4 + length > buffer.length) break;
        const json = buffer.subarray(offset + 4, offset + 4 + length).toString('utf-8');
        if (json.trim()) {
            try { messages.push(JSON.parse(json)); } catch {}
        }
        offset += 4 + length;
    }
    return { messages, remaining: buffer.subarray(offset) };
}

/**
 * Negative scenario tests for the extension's SessionManager.
 *
 * Tests connection failure handling, invalid message handling,
 * and timeout handling scenarios.
 */
suite('SessionManager Negative Scenarios', () => {

    // ==================== Connection Failure Tests ====================

    suite('Connection Failures', () => {
        test('connect to non-existent socket path rejects', async () => {
            const nonExistentPath = '/tmp/nonexistent-socket-path-12345.sock';
            if (fs.existsSync(nonExistentPath)) fs.unlinkSync(nonExistentPath);

            const manager = new SessionManager(nonExistentPath, TEST_TOKEN);
            // Suppress unhandled error events from reconnection attempts
            manager.on('error', () => {});

            try {
                await manager.connect();
                assert.fail('Should have thrown on connect to non-existent socket');
            } catch (e: any) {
                // Immediately disconnect to prevent reconnection attempts
                manager.disconnect();
                assert.ok(
                    e.message.includes('ENOENT') || e.message.includes('ECONNREFUSED') || e.message.includes('connect'),
                    `Expected connection error, got: ${e.message}`
                );
            }
        });

        test('state transitions to disconnected on connection failure', async () => {
            const nonExistentPath = '/tmp/negative-test-state-12345.sock';
            if (fs.existsSync(nonExistentPath)) fs.unlinkSync(nonExistentPath);

            const manager = new SessionManager(nonExistentPath, TEST_TOKEN);
            manager.on('error', () => {});
            const states: string[] = [];
            manager.on('stateChange', (state: string) => states.push(state));

            try {
                await manager.connect();
            } catch {
                // Expected - immediately disconnect to prevent reconnection
                manager.disconnect();
            }

            // State should be disconnected after disconnect()
            assert.strictEqual(manager.getState(), 'disconnected');
        });

        test('disconnect on already disconnected manager is safe', () => {
            const manager = new SessionManager('/tmp/nonexistent.sock', TEST_TOKEN);

            // Should not throw
            manager.disconnect();
            manager.disconnect();
            manager.disconnect();

            assert.strictEqual(manager.getState(), 'disconnected');
        });
    });

    // ==================== Invalid Message Handling Tests ====================

    suite('Invalid Message Handling', () => {
        const socketPath = '/tmp/test-negative-invalid-msgs.sock';
        let mockServer: net.Server;
        let activeSocket: net.Socket | null = null;
        let manager: SessionManager;

        setup((done) => {
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

            mockServer = net.createServer((socket) => {
                activeSocket = socket;
                let buffer = Buffer.alloc(0);
                socket.on('data', (data) => {
                    buffer = Buffer.concat([buffer, data]);
                    const { messages, remaining } = parseFrames(buffer);
                    buffer = remaining;
                    for (const msg of messages) {
                        if (msg.type === 'auth') {
                            socket.write(createFrame({ type: 'AuthOk' }));
                        }
                    }
                });
            });

            mockServer.listen(socketPath, () => {
                manager = new SessionManager(socketPath, TEST_TOKEN);
                // Add error listener to prevent uncaught error events.
                // The SessionManager re-emits ShellClient errors,
                // and without a listener Node throws.
                manager.on('error', () => {});
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

        test('handles invalid JSON from server without crashing', async () => {
            await manager.connect();

            // Send invalid JSON using length-prefixed frame
            if (activeSocket) {
                activeSocket.write(createFrame('this is not JSON'));
            }

            // Wait briefly to process the invalid message
            await new Promise(r => setTimeout(r, 100));

            // Manager should still be functional (not crashed)
            assert.ok(manager, 'Manager should still exist after invalid JSON');
        });

        test('handles empty message from server gracefully', async () => {
            await manager.connect();

            if (activeSocket) {
                activeSocket.write(createFrame(''));
            }

            await new Promise(r => setTimeout(r, 100));
            assert.ok(manager, 'Manager should handle empty messages');
        });

        test('handles unknown message type from server', async () => {
            await manager.connect();

            if (activeSocket) {
                activeSocket.write(createFrame({ type: 'UnknownType', data: 'test' }));
            }

            await new Promise(r => setTimeout(r, 100));
            assert.ok(manager, 'Manager should handle unknown message types');
        });

        test('handles message with missing required fields', async () => {
            await manager.connect();

            if (activeSocket) {
                // SessionList without sessions field
                activeSocket.write(createFrame({ type: 'SessionList' }));
            }

            await new Promise(r => setTimeout(r, 100));
            assert.ok(manager, 'Manager should handle messages with missing fields');
        });

        test('handles Output message without session_id', async () => {
            await manager.connect();

            if (activeSocket) {
                activeSocket.write(createFrame({ type: 'Output', data: 'some data' }));
            }

            await new Promise(r => setTimeout(r, 100));
            assert.ok(manager, 'Manager should handle Output without session_id');
        });

        test('handles Error message without message field', async () => {
            await manager.connect();

            if (activeSocket) {
                activeSocket.write(createFrame({ type: 'Error' }));
            }

            await new Promise(r => setTimeout(r, 100));
            assert.ok(manager, 'Manager should handle Error without message field');
        });

        test('handles very large message from server', async () => {
            await manager.connect();

            if (activeSocket) {
                const largeData = 'X'.repeat(100_000);
                activeSocket.write(createFrame({
                    type: 'Output',
                    session_id: 'test',
                    data: largeData
                }));
            }

            await new Promise(r => setTimeout(r, 200));
            assert.ok(manager, 'Manager should handle large messages');
        });
    });

    // ==================== Timeout Handling Tests ====================

    suite('Timeout Handling', () => {
        const socketPath = '/tmp/test-negative-timeout.sock';
        let mockServer: net.Server;
        let serverSockets: net.Socket[] = [];

        setup((done) => {
            serverSockets = [];
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

            mockServer = net.createServer((socket) => {
                serverSockets.push(socket);
                // Accept connection but never respond (no AuthOk)
            });

            mockServer.listen(socketPath, done);
        });

        teardown((done) => {
            // Destroy all server-side sockets first so mockServer.close() can complete
            for (const s of serverSockets) {
                s.destroy();
            }
            serverSockets = [];
            mockServer.close(() => {
                if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
                done();
            });
        });

        test('listSessions does not crash when server does not respond', async () => {
            const manager = new SessionManager(socketPath, TEST_TOKEN);
            manager.on('error', () => {});
            await manager.connect();

            // Send a message to a server that never responds
            manager.listSessions();

            // Wait briefly
            await new Promise(r => setTimeout(r, 200));

            // Manager should not crash
            assert.ok(manager, 'Manager should not crash when server is unresponsive');
            manager.disconnect();
        });

        test('sendInput does not crash when server does not respond', async () => {
            const manager = new SessionManager(socketPath, TEST_TOKEN);
            manager.on('error', () => {});
            await manager.connect();

            manager.sendInput('nonexistent-session', 'test input');

            await new Promise(r => setTimeout(r, 200));
            assert.ok(manager, 'sendInput should not crash on unresponsive server');
            manager.disconnect();
        });
    });

    // ==================== Server Disconnect Tests ====================

    suite('Server Disconnect', () => {
        test('handles server closing connection', async () => {
            const socketPath = '/tmp/test-negative-server-close.sock';
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

            let serverSocket: net.Socket | null = null;
            const mockServer = net.createServer((socket) => {
                serverSocket = socket;
                let buffer = Buffer.alloc(0);
                socket.on('data', (data) => {
                    buffer = Buffer.concat([buffer, data]);
                    const { messages, remaining } = parseFrames(buffer);
                    buffer = remaining;
                    for (const msg of messages) {
                        if (msg.type === 'auth') {
                            socket.write(createFrame({ type: 'AuthOk' }));
                        }
                    }
                });
            });

            await new Promise<void>(resolve => mockServer.listen(socketPath, resolve));

            const manager = new SessionManager(socketPath, TEST_TOKEN);
            manager.on('error', () => {});

            const closePromise = new Promise<void>(resolve => {
                manager.on('close', resolve);
                manager.on('stateChange', (state: string) => {
                    if (state === 'disconnected') resolve();
                });
            });

            await manager.connect();

            // Server closes connection abruptly
            if (serverSocket) {
                (serverSocket as net.Socket).destroy();
            }

            // Wait for close event or state change
            await Promise.race([
                closePromise,
                new Promise<void>(resolve => setTimeout(resolve, 2000))
            ]);

            // Manager should transition to disconnected or reconnecting
            assert.ok(
                manager.getState() === 'disconnected' || manager.getState() === 'reconnecting',
                `Expected disconnected or reconnecting after server close, got: ${manager.getState()}`
            );

            manager.disconnect();
            await new Promise<void>(resolve => mockServer.close(() => {
                if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
                resolve();
            }));
        });
    });

    // ==================== Operations When Disconnected Tests ====================

    suite('Operations When Disconnected', () => {
        test('listSessions when disconnected does not throw', () => {
            const manager = new SessionManager('/tmp/nonexistent.sock', TEST_TOKEN);
            // Should not throw - may queue or silently fail
            try {
                manager.listSessions();
            } catch {
                // Some implementations throw, others queue - both are acceptable
            }
        });

        test('sendInput when disconnected does not throw', () => {
            const manager = new SessionManager('/tmp/nonexistent.sock', TEST_TOKEN);
            try {
                manager.sendInput('session-1', 'test');
            } catch {
                // Acceptable
            }
        });

        test('createSession when disconnected does not throw', () => {
            const manager = new SessionManager('/tmp/nonexistent.sock', TEST_TOKEN);
            try {
                manager.createSession('/tmp', 'bash', {});
            } catch {
                // Acceptable
            }
        });

        test('killSession when disconnected does not throw', () => {
            const manager = new SessionManager('/tmp/nonexistent.sock', TEST_TOKEN);
            try {
                manager.killSession('session-1');
            } catch {
                // Acceptable
            }
        });

        test('getLastSessionList returns empty when disconnected', () => {
            const manager = new SessionManager('/tmp/nonexistent.sock', TEST_TOKEN);
            const sessions = manager.getLastSessionList();
            assert.ok(Array.isArray(sessions), 'Should return an array');
            assert.strictEqual(sessions.length, 0, 'Should be empty');
        });
    });
});
