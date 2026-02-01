import * as assert from 'assert';
import { SessionTreeProvider } from '../SessionTreeProvider';
import { EventEmitter } from 'events';

// Mock SessionManager
class MockSessionManager extends EventEmitter {
    constructor() { super(); }
}

suite('SessionTreeProvider', () => {
    test('initializes with empty list', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);
        const children = await provider.getChildren();
        assert.strictEqual(children.length, 0);
    });

    test('updates list on sessionList event', async () => {
        const manager = new MockSessionManager();
        const provider = new SessionTreeProvider(manager as any);
        
        let fired = false;
        provider.onDidChangeTreeData(() => { fired = true; });

        manager.emit('sessionList', [
            { id: '1', shell: 'bash' },
            { id: '2', shell: 'zsh', name: 'my-session' }
        ]);

        assert.strictEqual(fired, true);
        const children = await provider.getChildren();
        assert.strictEqual(children.length, 2);
        
        assert.strictEqual(children[0].label, 'bash');
        assert.strictEqual((children[0] as any).sessionId, '1');
        
        assert.strictEqual(children[1].label, 'my-session');
        assert.strictEqual((children[1] as any).sessionId, '2');
    });
});
