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

    test('async child process error emits on controller with original message', async () => {
        const mockSpawner = () => {
            const child = new MockChildProcess();
            setTimeout(() => child.emit('error', new Error('Spawn failed')), 10);
            return child as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);

        // spawn() resolves immediately (fire-and-forget); errors arrive asynchronously
        const errorPromise = new Promise<Error>((resolve) => {
            controller.on('error', resolve);
        });

        await controller.spawn();

        const emittedError = await errorPromise;
        assert.strictEqual(emittedError.message, 'Spawn failed',
            'Emitted error should contain the original error message');
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
