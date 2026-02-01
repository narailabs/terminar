import * as path from 'path';
const moduleAlias = require('module-alias');

// Alias 'vscode' to our mock implementation in the output directory
moduleAlias.addAlias('vscode', path.join(__dirname, 'mocks/vscode.js'));