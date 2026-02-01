// Register 'vscode' module mock before any tests run
const path = require('path');
const Module = require('module');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'vscode') {
        return require.resolve(path.join(__dirname, '..', '..', 'out-test', 'src', 'test', 'mocks', 'vscode.js'));
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};
