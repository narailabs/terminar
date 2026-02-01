import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionTreeProvider } from '../SessionTreeProvider';
import { EventEmitter } from 'events';

// Mock SessionManager
class MockSessionManager extends EventEmitter {
    constructor() { super(); }
}

suite('SessionTreeProvider Enhanced', () => {

    test('session item shows running icon for active session', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: '', started_at: new Date().toISOString(), status: 'running' }
        ]);

        const children = await provider.getChildren();
        assert.strictEqual(children.length, 1);

        const item = children[0];
        // iconPath should be a ThemeIcon with 'debug-start' or similar codicon
        assert.ok(item.iconPath, 'Should have an icon');
        assert.strictEqual((item.iconPath as any).id, 'debug-start', 'Running session should use debug-start icon');
    });

    test('session item shows idle icon for idle session', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: '', started_at: new Date().toISOString(), status: 'idle' }
        ]);

        const children = await provider.getChildren();
        const item = children[0];
        assert.ok(item.iconPath, 'Should have an icon');
        assert.strictEqual((item.iconPath as any).id, 'debug-pause', 'Idle session should use debug-pause icon');
    });

    test('session item shows error icon for error session', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: '', started_at: new Date().toISOString(), status: 'error' }
        ]);

        const children = await provider.getChildren();
        const item = children[0];
        assert.ok(item.iconPath, 'Should have an icon');
        assert.strictEqual((item.iconPath as any).id, 'warning', 'Error session should use warning icon');
    });

    test('session item defaults to running icon when no status', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: '' }
        ]);

        const children = await provider.getChildren();
        const item = children[0];
        assert.ok(item.iconPath, 'Should have an icon even without status');
        assert.strictEqual((item.iconPath as any).id, 'debug-start', 'Default should be running icon');
    });

    test('session item has contextValue "session" for context menu', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: '' }
        ]);

        const children = await provider.getChildren();
        const item = children[0];
        assert.strictEqual(item.contextValue, 'session', 'Should have session context value');
    });

    test('session item tooltip includes session details', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        const startedAt = '2025-01-15T10:30:00Z';
        manager.emit('sessionList', [
            { id: 'abc-123', shell: '/bin/bash', name: 'dev', started_at: startedAt }
        ]);

        const children = await provider.getChildren();
        const item = children[0];
        const tooltip = item.tooltip as string;
        assert.ok(tooltip.includes('abc-123'), 'Tooltip should include session ID');
        assert.ok(tooltip.includes('/bin/bash'), 'Tooltip should include shell path');
        assert.ok(tooltip.includes('Started'), 'Tooltip should include start time info');
    });

    test('session item description shows shell name', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: '/bin/zsh', name: 'my-session' }
        ]);

        const children = await provider.getChildren();
        const item = children[0];
        assert.strictEqual(item.description, '/bin/zsh', 'Description should show shell');
    });

    test('session item label uses name when available', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: 'my-project' }
        ]);

        const children = await provider.getChildren();
        assert.strictEqual(children[0].label, 'my-project');
    });

    test('session item label falls back to shell when no name', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: '1', shell: 'bash', name: '' }
        ]);

        const children = await provider.getChildren();
        assert.strictEqual(children[0].label, 'bash');
    });

    test('sessionId is available on tree item for commands', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        manager.emit('sessionList', [
            { id: 'session-xyz', shell: 'bash', name: '' }
        ]);

        const children = await provider.getChildren();
        assert.strictEqual((children[0] as any).sessionId, 'session-xyz');
    });
});
