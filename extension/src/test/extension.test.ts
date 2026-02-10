import * as assert from 'assert';
import { activate } from '../extension';
import * as vscode from 'vscode';
import { SessionManager } from '../SessionManager';

suite('Extension Activation', () => {

    test('registers commands and providers', async () => {

        const originalConnect = SessionManager.prototype.connect;
        const originalCreateSession = SessionManager.prototype.createSession;

        // Mock SessionManager methods to prevent real server connections
        SessionManager.prototype.connect = () => Promise.resolve();
        SessionManager.prototype.createSession = () => {};

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

            // 2. Test newSession command exists and can be called without crashing
            // Note: With class-based TerminarExtension, createSession only fires
            // when a manager is connected. Without a real server, this safely no-ops.
            await registeredCommands['terminar.newSession']();

            // 3. Restore spies
            (vscode.commands as any).registerCommand = originalRegisterCommand;
            (vscode.window as any).registerTreeDataProvider = originalRegisterTree;

        } finally {
            SessionManager.prototype.connect = originalConnect;
            SessionManager.prototype.createSession = originalCreateSession;
        }
    });

});
