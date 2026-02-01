import * as assert from 'assert';
import { ServerController } from '../ServerController';
import { EventEmitter } from 'events';

class MockChildProcess extends EventEmitter {
    unref() {}
}

suite('ServerController', () => {
    test('spawns server process', async () => {
        let spawned = false;
        const mockSpawner = (cmd: string, args: string[], opts: any) => {
            spawned = true;
            assert.ok(cmd.endsWith('terminar-server'));
            assert.ok(opts.detached);
            return new MockChildProcess() as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);
        await controller.spawn();
        assert.ok(spawned);
    });

    test('bubbles spawn errors', async () => {
        const mockSpawner = () => {
            const child = new MockChildProcess();
            setTimeout(() => child.emit('error', new Error('Spawn failed')), 10);
            return child as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);
        
        try {
            await controller.spawn();
            // In current implementation, spawn resolves immediately after unref.
            // Error is emitted via 'error' event on controller.
        } catch (e) {
            // Should not throw here unless sync error
        }

        return new Promise<void>((resolve, reject) => {
            controller.on('error', (err) => {
                assert.strictEqual(err.message, 'Spawn failed');
                resolve();
            });
        });
    });
});
