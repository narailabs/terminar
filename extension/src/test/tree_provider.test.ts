import * as assert from 'assert';
import { SessionTreeProvider } from '../SessionTreeProvider';
import { EventEmitter } from 'events';

// Mock SessionManager
class MockSessionManager extends EventEmitter {
    constructor() { super(); }
}

suite('SessionTreeProvider', () => {
    // Note: 'initializes with empty list' was removed — redundant with
    // tree_provider_enhanced.test.ts which implicitly covers empty-state
    // via fresh provider instances in every test.

    test('sessionList event fires onDidChangeTreeData and updates children', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);

        // Verify empty before any event
        const before = await provider.getChildren();
        assert.strictEqual(before.length, 0, 'Should start empty');

        let changeEventCount = 0;
        provider.onDidChangeTreeData(() => { changeEventCount++; });

        manager.emit('sessionList', [
            { id: '1', shell: 'bash' },
            { id: '2', shell: 'zsh', name: 'my-session' }
        ]);

        assert.strictEqual(changeEventCount, 1, 'onDidChangeTreeData should fire once');
        const children = await provider.getChildren();
        assert.strictEqual(children.length, 2, 'Should have 2 sessions');

        assert.strictEqual(children[0].label, 'bash');
        assert.strictEqual((children[0] as any).sessionId, '1');

        assert.strictEqual(children[1].label, 'my-session');
        assert.strictEqual((children[1] as any).sessionId, '2');

        // Emit again — should fire change event again and replace the list
        manager.emit('sessionList', [
            { id: '3', shell: 'fish', name: 'only-one' }
        ]);

        assert.strictEqual(changeEventCount, 2, 'onDidChangeTreeData should fire again');
        const updated = await provider.getChildren();
        assert.strictEqual(updated.length, 1, 'Should have 1 session after update');
        assert.strictEqual(updated[0].label, 'only-one');
    });
});
