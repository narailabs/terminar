import * as assert from 'assert';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { SessionManager } from '../../SessionManager';

suite('E2E Protocol Integration', function() {
    this.timeout(10000); 

    let serverProcess: cp.ChildProcess;
    let manager: SessionManager;
    const socketPath = '/tmp/test-vscode-e2e.sock';
    const serverBin = path.resolve(__dirname, '../../../../../bazel-bin/server/terminar-server');

    setup(async () => {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        if (fs.existsSync(serverBin) === false) {
             console.error(`Server binary not found at ${serverBin}. Please run 'bazel build //server'`);
             throw new Error('Server binary missing');
        }
        
        // Spawn server with Mock PTY for deterministic testing
        serverProcess = cp.spawn(serverBin, ['--socket', socketPath, '--no-auth', '--mock-pty'], {
             stdio: 'inherit'
        });
        
        // Wait for socket
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
        if (serverProcess) {
            serverProcess.kill();
        }
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    });

    test('full session lifecycle against real backend', async () => {
        // 1. List Sessions (Empty)
        const initialListPromise = new Promise<any[]>(resolve => manager.once('sessionList', resolve));
        manager.listSessions();
        const initialList = await initialListPromise;
        // Depending on mock backend state, might be empty or not (mock pty provider doesn't persist)
        
        // 2. Create Session
        manager.createSession('/tmp', 'bash', {});
        
        // Wait for list update
        const updatedList = await new Promise<any[]>(resolve => manager.once('sessionList', resolve));
        const newSession = updatedList.find(s => !initialList.find(i => i.id === s.id));
        assert.ok(newSession, 'Should have created a new session');
        
        // 3. Attach
        manager.attach(newSession!.id);
        
        let accumulatedOutput = '';
        const outputPromise = new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout waiting for output. Received so far: '${accumulatedOutput}'`));
            }, 2000);

            manager.on('output', (sid, data) => {
                if (sid === newSession!.id) {
                    console.log(`[Test] Received chunk: '${data}'`);
                    accumulatedOutput += data;
                    if (accumulatedOutput.includes('Hello')) {
                        clearTimeout(timeout);
                        resolve(accumulatedOutput);
                    }
                }
            });
        });

        // 4. Send Input (Mock PTY echoes input)
        // We send "Hello"
        manager.sendInput(newSession!.id, 'Hello');
        
        const output = await outputPromise;
        // Mock PTY echoes: "Echo: Hello" or just "Hello"?
        // Let's check what MockPtyProvider does in server source if needed, or just assert we got something.
        assert.ok(output.length > 0, 'Should receive output');
        // Based on typical echo pty implementation:
        assert.ok(output.includes('Hello'), `Output '${output}' should include sent input 'Hello'`);

        // 5. Kill Session
        manager.killSession(newSession!.id);
        
        // Wait for list update
        const finalList = await new Promise<any[]>(resolve => manager.once('sessionList', resolve));
        assert.ok(!finalList.find(s => s.id === newSession!.id), 'Session should be removed');
    });
});
