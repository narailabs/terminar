import * as assert from 'assert';
import { NetSocketAdapter } from '../NetSocketAdapter';
import { EventEmitter } from 'events';

class MockNetSocket extends EventEmitter {
    write = (data: any) => {};
    destroy = () => {};
}

/**
 * Helper to create a length-prefixed frame from a string payload.
 * Frame format: 4-byte big-endian uint32 length + payload bytes.
 */
function createFrame(payload: string): Buffer {
    const payloadBuf = Buffer.from(payload, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payloadBuf.length, 0);
    return Buffer.concat([header, payloadBuf]);
}

suite('NetSocketAdapter', () => {
    test('emits open on connect', (done) => {
        const socket = new MockNetSocket();
        const adapter = new NetSocketAdapter(socket as any);
        adapter.on('open', () => done());
        socket.emit('connect');
    });

    test('emits message on data with length-prefixed frame', (done) => {
        const socket = new MockNetSocket();
        const adapter = new NetSocketAdapter(socket as any);
        adapter.on('message', (msg) => {
            assert.strictEqual(msg, 'hello');
            done();
        });
        socket.emit('data', createFrame('hello'));
    });

    test('buffers partial data', () => {
        const socket = new MockNetSocket();
        const adapter = new NetSocketAdapter(socket as any);
        let count = 0;
        adapter.on('message', () => count++);

        const frame = createFrame('hello');
        // Send only the first 3 bytes (header incomplete)
        socket.emit('data', frame.subarray(0, 3));
        assert.strictEqual(count, 0);

        // Send the rest
        socket.emit('data', frame.subarray(3));
        assert.strictEqual(count, 1);
    });

    test('sends data with length-prefixed frame', () => {
        const socket = new MockNetSocket();
        let sentBuf: Buffer | null = null;
        socket.write = (data: any) => { sentBuf = data; };

        const adapter = new NetSocketAdapter(socket as any);
        adapter.send('ping');

        assert.ok(sentBuf, 'Should have written data');
        // Verify length prefix
        const length = (sentBuf as Buffer).readUInt32BE(0);
        assert.strictEqual(length, Buffer.from('ping', 'utf-8').length);
        // Verify payload
        const payload = (sentBuf as Buffer).subarray(4).toString('utf-8');
        assert.strictEqual(payload, 'ping');
    });
});
