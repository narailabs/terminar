import * as assert from 'assert';
import { ServerController } from '../ServerController';
import { EventEmitter } from 'events';

class MockChildProcess extends EventEmitter {
    public killed = false;
    unref() {}
    kill(signal?: string) { this.killed = true; }
}

suite('ServerController', () => {
    test('spawns server process with correct binary path and detached mode', async () => {
        let spawnedCmd = '';
        let spawnedOpts: any = {};
        const mockChild = new MockChildProcess();
        const mockSpawner = (cmd: string, args: string[], opts: any) => {
            spawnedCmd = cmd;
            spawnedOpts = opts;
            return mockChild as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);
        await controller.spawn();

        assert.ok(spawnedCmd.endsWith('terminar-server'),
            `Expected binary path ending with terminar-server, got: ${spawnedCmd}`);
        assert.strictEqual(spawnedOpts.detached, true, 'Should spawn detached');
        assert.strictEqual(spawnedOpts.stdio, 'ignore', 'Should ignore stdio');
    });

    test('spawn resolves immediately (fire-and-forget) and errors arrive via event', async () => {
        const mockChild = new MockChildProcess();
        const mockSpawner = () => {
            setTimeout(() => mockChild.emit('error', new Error('Spawn failed')), 10);
            return mockChild as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);

        // spawn() resolves immediately after unref, before the async error fires
        await controller.spawn();

        // The error arrives asynchronously via the controller's 'error' event
        const err = await new Promise<Error>((resolve) => {
            controller.on('error', resolve);
        });
        assert.strictEqual(err.message, 'Spawn failed');
    });

    test('spawnWithPath uses the exact binary path provided', async () => {
        let spawnedCmd = '';
        const mockSpawner = (cmd: string, args: string[], opts: any) => {
            spawnedCmd = cmd;
            return new MockChildProcess() as any;
        };

        const controller = new ServerController('/irrelevant', mockSpawner);
        await controller.spawnWithPath('/custom/bin/my-server');
        assert.strictEqual(spawnedCmd, '/custom/bin/my-server');
    });
});
