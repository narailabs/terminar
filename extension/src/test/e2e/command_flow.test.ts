import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode'; 
import { activate } from '../../extension';
import { SessionManager } from '../../SessionManager';

suite('E2E Command Flow', function() {
    this.timeout(10000);
    const uid = os.userInfo().uid;
    const socketPath = `/tmp/vscode-terminar-${uid}.sock`;
    const serverBin = path.resolve(__dirname, '../../../../../../../bazel-bin/apps/terminar/server/terminar-server');
    let serverProcess: cp.ChildProcess;

    setup(async () => {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        if (!fs.existsSync(serverBin)) throw new Error('Server binary missing');

        serverProcess = cp.spawn(serverBin, ['--socket', socketPath, '--no-auth', '--mock-pty'], { stdio: 'ignore' });
        
        await new Promise<void>((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (fs.existsSync(socketPath)) resolve();
                else if (Date.now() - start > 5000) reject(new Error('Timeout waiting for server socket'));
                else setTimeout(check, 100);
            };
            check();
        });
    });

    teardown(() => {
        if (serverProcess) serverProcess.kill();
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        // Clean up vscode registry?
        (vscode.commands as any).registry.clear();
    });

    test('newSession command triggers session creation', async () => {
        const context: any = { subscriptions: [], extensionPath: __dirname }; // Dummy path
        
        // 1. Activate Extension (Connects to our spawned server)
        activate(context);
        
        // Wait for connection (extension logs "Connected to backend")
        // We assume it takes < 1s
        await new Promise(r => setTimeout(r, 1000));

        // 2. Execute newSession
        await vscode.commands.executeCommand('terminar.newSession');
        
        // 3. Verify Session Created
        // We can check by creating a separate SessionManager and listing sessions
        const verifier = new SessionManager(socketPath);
        await verifier.connect();
        
        const sessions = await new Promise<any[]>(resolve => {
            verifier.once('sessionList', resolve);
            verifier.listSessions();
        });
        
        assert.ok(sessions.length > 0, 'Should have at least one session');
        verifier.disconnect();
    });
});
