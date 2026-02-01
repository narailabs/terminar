import * as assert from 'assert';
import * as vscode from 'vscode';
import { ServerController } from '../ServerController';
import { EventEmitter } from 'events';

class MockChildProcess extends EventEmitter {
    unref() {}
}

suite('Extension Server Error Handling Integration', () => {
    test('showServerError displays notification with error message', () => {
        // Import the helper function we will create
        const { showServerError } = require('../errorHandling');

        let shownMessage = '';
        let shownItems: string[] = [];
        const originalShowError = vscode.window.showErrorMessage;
        (vscode.window as any).showErrorMessage = (msg: string, ...items: string[]) => {
            shownMessage = msg;
            shownItems = items;
            return Promise.resolve(undefined);
        };

        showServerError(new Error('ENOENT: server binary not found'));

        assert.ok(shownMessage.includes('server'), 'Error message should mention server');
        assert.ok(shownMessage.includes('ENOENT'), 'Error message should include error details');

        (vscode.window as any).showErrorMessage = originalShowError;
    });

    test('showServerError offers Retry option', () => {
        const { showServerError } = require('../errorHandling');

        let shownItems: string[] = [];
        const originalShowError = vscode.window.showErrorMessage;
        (vscode.window as any).showErrorMessage = (msg: string, ...items: string[]) => {
            shownItems = items;
            return Promise.resolve(undefined);
        };

        showServerError(new Error('spawn failed'));

        assert.ok(shownItems.includes('Retry'), 'Should offer Retry option');

        (vscode.window as any).showErrorMessage = originalShowError;
    });

    test('showServerError calls onRetry when Retry is selected', async () => {
        const { showServerError } = require('../errorHandling');

        const originalShowError = vscode.window.showErrorMessage;
        (vscode.window as any).showErrorMessage = (msg: string, ...items: string[]) => {
            return Promise.resolve('Retry');
        };

        let retryCalled = false;
        await showServerError(new Error('spawn failed'), () => { retryCalled = true; });

        assert.ok(retryCalled, 'onRetry callback should be called');

        (vscode.window as any).showErrorMessage = originalShowError;
    });

    test('logServerError writes to output channel', () => {
        const { logServerError } = require('../errorHandling');

        const lines: string[] = [];
        const mockChannel = {
            appendLine: (msg: string) => { lines.push(msg); },
            show: () => {},
            dispose: () => {}
        };

        logServerError(mockChannel, new Error('Something went wrong'));

        assert.ok(lines.length > 0, 'Should log at least one line');
        assert.ok(lines.some(l => l.includes('Something went wrong')), 'Should include error message');
    });

    test('setupServerErrorHandler wires controller error to notification', (done) => {
        const { setupServerErrorHandler } = require('../errorHandling');

        const mockSpawner = () => {
            const child = new MockChildProcess();
            setTimeout(() => child.emit('error', new Error('Test error')), 10);
            return child as any;
        };

        const controller = new ServerController('/tmp', mockSpawner);

        const lines: string[] = [];
        const mockChannel = {
            appendLine: (msg: string) => { lines.push(msg); },
            show: () => {},
            dispose: () => {}
        };

        let errorShown = false;
        const originalShowError = vscode.window.showErrorMessage;
        (vscode.window as any).showErrorMessage = (msg: string, ...items: string[]) => {
            errorShown = true;
            return Promise.resolve(undefined);
        };

        setupServerErrorHandler(controller, mockChannel);

        controller.spawn().catch(() => {});

        setTimeout(() => {
            assert.ok(errorShown, 'Should show error notification');
            assert.ok(lines.some(l => l.includes('Test error')), 'Should log error');
            (vscode.window as any).showErrorMessage = originalShowError;
            done();
        }, 50);
    });
});
