import * as cp from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';

type SpawnFn = (command: string, args: string[], options: cp.SpawnOptions) => cp.ChildProcess;

export class ServerController extends EventEmitter {
    private spawner: SpawnFn;

    constructor(private extensionPath: string, spawner?: SpawnFn) {
        super();
        this.spawner = spawner || cp.spawn;
    }

    /**
     * Spawn the server using the default binary path derived from extensionPath.
     */
    public spawn(): Promise<void> {
        const serverBin = path.join(this.extensionPath, '..', 'server', 'target', 'debug', 'terminar-server');
        return this.spawnWithPath(serverBin);
    }

    /**
     * Spawn the server using a specific binary path.
     * Useful when a custom serverPath is configured in settings.
     */
    public spawnWithPath(serverBin: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const child = this.spawner(serverBin, [], {
                    detached: true,
                    stdio: 'ignore'
                });

                child.on('error', (err) => {
                    this.emit('error', err);
                    reject(err);
                });

                child.unref();
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }
}
