import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SessionManager } from '../../SessionManager';

suite('E2E Multi-Session', function() {
    this.timeout(15000); 

    let serverProcess: cp.ChildProcess;
    let manager: SessionManager;
    const socketPath = '/tmp/test-vscode-e2e-multi.sock';
    const serverBin = path.resolve(__dirname, '../../../../../bazel-bin/server/terminar-server');

    setup(async () => {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        if (fs.existsSync(serverBin) === false) {
             throw new Error('Server binary missing');
        }
        
        serverProcess = cp.spawn(serverBin, ['--socket', socketPath, '--no-auth', '--mock-pty'], {
             stdio: 'ignore' 
        });
        
        await new Promise<void>((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (fs.existsSync(socketPath)) resolve();
                else if (Date.now() - start > 5000) reject(new Error('Timeout waiting for server socket'));
                else setTimeout(check, 100);
            };
            check();
        });

        manager = new SessionManager(socketPath);
        await manager.connect();
    });

    teardown(() => {
        if (manager) manager.disconnect();
        if (serverProcess) serverProcess.kill();
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    });

    test('multiplexes input and output correctly', async () => {
        // 1. Create two sessions
        manager.createSession('/tmp', 'bash', {});
        manager.createSession('/tmp', 'bash', {});
        
        // Wait for both to appear
        const sessions = await new Promise<any[]>(resolve => {
            manager.on('sessionList', (list) => {
                if (list.length >= 2) resolve(list);
            });
            // Trigger list refresh just in case
            manager.listSessions();
        });

        assert.strictEqual(sessions.length, 2);
        const id1 = sessions[0].id;
        const id2 = sessions[1].id;

        // 2. Attach to both
        manager.attach(id1);
        manager.attach(id2);

        // 3. Set up listeners
        const output1: string[] = [];
        const output2: string[] = [];

        manager.on('output', (sid, data) => {
            if (sid === id1) output1.push(data);
            if (sid === id2) output2.push(data);
        });

        // 4. Send to Session 1 only
        manager.sendInput(id1, 'DATA_FOR_ONE');
        
        // Wait a bit
        await new Promise(r => setTimeout(r, 200));

        // 5. Verify routing
        const joined1 = output1.join('');
        const joined2 = output2.join('');

        assert.ok(joined1.includes('DATA_FOR_ONE'), 'Session 1 should receive its data');
        assert.ok(!joined2.includes('DATA_FOR_ONE'), 'Session 2 should NOT receive Session 1 data');

        // 6. Send to Session 2
        manager.sendInput(id2, 'DATA_FOR_TWO');
        await new Promise(r => setTimeout(r, 200));

        const joined2_updated = output2.join('');
        assert.ok(joined2_updated.includes('DATA_FOR_TWO'), 'Session 2 should receive its data');
    });
});
