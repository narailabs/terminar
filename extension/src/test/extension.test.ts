import * as assert from 'assert';
import { activate } from '../extension';
import * as vscode from 'vscode';
import { SessionManager } from '../SessionManager';

suite('Extension Activation', () => {

    test('registers commands and providers', async () => {

        const originalConnect = SessionManager.prototype.connect;
        const originalCreateSession = SessionManager.prototype.createSession;

        // Mock SessionManager methods
        SessionManager.prototype.connect = () => Promise.resolve();

        let createSessionCalled = false;
        SessionManager.prototype.createSession = (cwd, shell, env) => {
            createSessionCalled = true;
        };

        try {
            const subscriptions: any[] = [];
            const context: any = {
                subscriptions,
                extensionPath: '/mock/path',
                secrets: {
                    store: () => Promise.resolve(),
                    get: () => Promise.resolve(undefined)
                }
            };

            const registeredCommands: Record<string, Function> = {};
            const originalRegisterCommand = vscode.commands.registerCommand;
            (vscode.commands as any).registerCommand = (command: string, cb: any) => {
                registeredCommands[command] = cb;
                return originalRegisterCommand(command, cb);
            };

            const registeredProviders: string[] = [];
            const originalRegisterTree = vscode.window.registerTreeDataProvider;
            (vscode.window as any).registerTreeDataProvider = (viewId: string, provider: any) => {
                registeredProviders.push(viewId);
                return originalRegisterTree(viewId, provider);
            };

            // 1. Activate
            activate(context);

            assert.ok(registeredCommands['terminar.newSession']);
            assert.ok(registeredCommands['terminar.connectRemote']);
            assert.ok(registeredProviders.includes('terminarSessions'));

            // 2. Test newSession command
            await registeredCommands['terminar.newSession']();
            assert.strictEqual(createSessionCalled, true, 'createSession should be called');

            // 3. Test connectRemote command
            // We need to mock showInputBox to return host and code
            const originalShowInputBox = vscode.window.showInputBox;
            let inputCallCount = 0;
            (vscode.window as any).showInputBox = () => {
                inputCallCount++;
                return Promise.resolve(inputCallCount === 1 ? 'localhost:3000' : '123456');
            };

            const originalShowInfo = vscode.window.showInformationMessage;
            let infoMessage = '';
            (vscode.window as any).showInformationMessage = (msg: string) => {
                infoMessage = msg;
                return Promise.resolve();
            };

            await registeredCommands['terminar.connectRemote']();
            assert.ok(infoMessage.includes('Pairing') || infoMessage.includes('pair'), 'Should show pairing message');

            // Restore spies
            (vscode.commands as any).registerCommand = originalRegisterCommand;
            (vscode.window as any).registerTreeDataProvider = originalRegisterTree;
            (vscode.window as any).showInputBox = originalShowInputBox;
            (vscode.window as any).showInformationMessage = originalShowInfo;

        } finally {
            SessionManager.prototype.connect = originalConnect;
            SessionManager.prototype.createSession = originalCreateSession;
        }
    });

});
