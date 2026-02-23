import * as assert from 'assert';
import * as vscode from 'vscode';

suite('VS Code Settings Configuration', () => {
    test('getConfiguration returns terminar section', () => {
        // The extension should read settings from the 'terminar' section
        const config = vscode.workspace.getConfiguration('terminar');
        assert.ok(config, 'Should return a configuration object');
        assert.strictEqual(typeof config.get, 'function', 'Should have a get method');
    });

    test('serverPath setting has correct default (empty string)', () => {
        const config = vscode.workspace.getConfiguration('terminar');
        const serverPath = config.get<string>('serverPath', '');
        assert.strictEqual(serverPath, '', 'Default serverPath should be empty string');
    });

    test('socketPath setting has correct default (empty string)', () => {
        const config = vscode.workspace.getConfiguration('terminar');
        const socketPath = config.get<string>('socketPath', '');
        assert.strictEqual(socketPath, '', 'Default socketPath should be empty string');
    });

    test('autoStart setting has correct default (true)', () => {
        const config = vscode.workspace.getConfiguration('terminar');
        const autoStart = config.get<boolean>('autoStart', true);
        assert.strictEqual(autoStart, true, 'Default autoStart should be true');
    });

    test('getSocketPath returns default then respects config change', () => {
        const { getConfiguredSocketPath } = require('../settings');

        // Default path should contain 'terminar' and the uid
        const defaultPath = getConfiguredSocketPath();
        assert.ok(defaultPath.includes('terminar'), 'Default path should contain terminar');
        assert.ok(defaultPath.endsWith('.sock'), 'Default path should end with .sock');

        // Set a custom value and verify it takes effect
        (vscode.workspace as any)._setConfigValue('terminar.socketPath', '/tmp/custom.sock');
        assert.strictEqual(getConfiguredSocketPath(), '/tmp/custom.sock',
            'Should return custom path after config change');

        // Reset and verify it reverts to default
        (vscode.workspace as any)._resetConfig();
        const afterReset = getConfiguredSocketPath();
        assert.strictEqual(afterReset, defaultPath,
            'Should revert to default after config reset');
    });

    test('getServerBinaryPath returns null then respects config change', () => {
        const { getConfiguredServerPath } = require('../settings');

        // Default should be null when not configured
        assert.strictEqual(getConfiguredServerPath(), null, 'Default should be null');

        // Set a custom value
        (vscode.workspace as any)._setConfigValue('terminar.serverPath', '/usr/bin/custom-server');
        assert.strictEqual(getConfiguredServerPath(), '/usr/bin/custom-server',
            'Should return custom server path');

        (vscode.workspace as any)._resetConfig();
        assert.strictEqual(getConfiguredServerPath(), null,
            'Should revert to null after config reset');
    });

    test('getAutoStart returns true then respects config change', () => {
        const { getAutoStart } = require('../settings');

        // Default should be true
        assert.strictEqual(getAutoStart(), true, 'Default autoStart should be true');

        // Set to false
        (vscode.workspace as any)._setConfigValue('terminar.autoStart', false);
        assert.strictEqual(getAutoStart(), false,
            'Should return false after config change');

        (vscode.workspace as any)._resetConfig();
        assert.strictEqual(getAutoStart(), true,
            'Should revert to true after config reset');
    });

    test('getConfiguredSocketPath returns custom path when configured', () => {
        const { getConfiguredSocketPath } = require('../settings');

        // Set a custom socket path via the mock config store
        (vscode.workspace as any)._setConfigValue('terminar.socketPath', '/custom/socket.sock');

        const result = getConfiguredSocketPath();
        assert.strictEqual(result, '/custom/socket.sock', 'Should return custom socket path');

        // Clean up
        (vscode.workspace as any)._resetConfig();
    });

    test('getConfiguredServerPath returns custom path when configured', () => {
        const { getConfiguredServerPath } = require('../settings');

        (vscode.workspace as any)._setConfigValue('terminar.serverPath', '/usr/local/bin/my-server');

        const result = getConfiguredServerPath();
        assert.strictEqual(result, '/usr/local/bin/my-server', 'Should return custom server path');

        (vscode.workspace as any)._resetConfig();
    });

    test('getAutoStart returns false when configured as false', () => {
        const { getAutoStart } = require('../settings');

        (vscode.workspace as any)._setConfigValue('terminar.autoStart', false);

        const result = getAutoStart();
        assert.strictEqual(result, false, 'Should return false when configured');

        (vscode.workspace as any)._resetConfig();
    });
});
