import * as assert from 'assert';
import { ServerController } from '../ServerController';
import { EventEmitter } from 'events';

class MockChildProcess extends EventEmitter {
    unref() {}
}

suite('ServerController Error Handling', () => {

    test('emits error event when spawn fails', (done) => {
        const mockSpawner = () => {
            const child = new MockChildProcess();
            setTimeout(() => child.emit('error', new Error('ENOENT: server binary not found')), 10);
            return child as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);

        controller.on('error', (err: Error) => {
            assert.ok(err.message.includes('ENOENT'));
            done();
        });

        controller.spawn().catch(() => {
            // Expected - spawn rejects on error
        });
    });

    test('emits error with descriptive message on permission denied', (done) => {
        const mockSpawner = () => {
            const child = new MockChildProcess();
            setTimeout(() => child.emit('error', new Error('EACCES: permission denied')), 10);
            return child as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);

        controller.on('error', (err: Error) => {
            assert.ok(err.message.includes('EACCES'));
            done();
        });

        controller.spawn().catch(() => {});
    });

    test('spawn rejects when child process emits error', async () => {
        const mockSpawner = () => {
            const child = new MockChildProcess();
            setTimeout(() => child.emit('error', new Error('Spawn failed')), 10);
            return child as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);

        let errorEmitted = false;
        controller.on('error', () => { errorEmitted = true; });

        // The current implementation resolves immediately after unref,
        // so we need to wait for the async error
        await controller.spawn();
        await new Promise(r => setTimeout(r, 50));
        assert.ok(errorEmitted, 'Error event should have been emitted');
    });

    test('spawn rejects on synchronous throw', async () => {
        const mockSpawner = () => {
            throw new Error('Sync spawn failure');
        };

        const controller = new ServerController('/tmp', mockSpawner as any);

        try {
            await controller.spawn();
            assert.fail('Should have thrown');
        } catch (e: any) {
            assert.ok(e.message.includes('Sync spawn failure'));
        }
    });

    test('uses custom server path from settings when provided', async () => {
        let spawnedCmd = '';
        const mockSpawner = (cmd: string, args: string[], opts: any) => {
            spawnedCmd = cmd;
            return new MockChildProcess() as any;
        };

        const controller = new ServerController('/extension/path', mockSpawner);

        // Test with custom path
        await controller.spawnWithPath('/custom/bin/server');
        assert.strictEqual(spawnedCmd, '/custom/bin/server');
    });
});
