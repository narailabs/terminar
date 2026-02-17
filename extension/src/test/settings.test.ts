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

    test('getSocketPath uses configured socketPath when set', () => {
        // We test the getConfiguredSocketPath helper
        const { getConfiguredSocketPath } = require('../settings');

        // With no config value, should return default socket path
        const defaultPath = getConfiguredSocketPath();
        assert.ok(defaultPath.includes('.sock') || defaultPath.includes('terminar'),
            'Default path should be a socket path');
    });

    test('getServerBinaryPath uses configured serverPath when set', () => {
        const { getConfiguredServerPath } = require('../settings');

        // With no config value, should return null (use default)
        const defaultBin = getConfiguredServerPath();
        assert.strictEqual(defaultBin, null, 'Default should be null when not configured');
    });

    test('getAutoStart returns configured value', () => {
        const { getAutoStart } = require('../settings');

        // Default should be true
        const autoStart = getAutoStart();
        assert.strictEqual(autoStart, true, 'Default autoStart should be true');
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
