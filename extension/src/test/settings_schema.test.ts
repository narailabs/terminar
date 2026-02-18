import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

suite('Settings Schema (package.json)', () => {
    let packageJson: any;

    setup(() => {
        const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
        packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    });

    test('contributes.configuration exists', () => {
        assert.ok(packageJson.contributes.configuration, 'Should have configuration section');
        assert.strictEqual(packageJson.contributes.configuration.title, 'terminar');
    });

    test('serverPath property is defined', () => {
        const props = packageJson.contributes.configuration.properties;
        const prop = props['terminar.serverPath'];
        assert.ok(prop, 'serverPath property should exist');
        assert.strictEqual(prop.type, 'string');
        assert.strictEqual(prop.default, '');
        assert.ok(prop.description.length > 0, 'Should have a description');
    });

    test('socketPath property is defined', () => {
        const props = packageJson.contributes.configuration.properties;
        const prop = props['terminar.socketPath'];
        assert.ok(prop, 'socketPath property should exist');
        assert.strictEqual(prop.type, 'string');
        assert.strictEqual(prop.default, '');
    });

    test('autoStart property is defined with boolean type and true default', () => {
        const props = packageJson.contributes.configuration.properties;
        const prop = props['terminar.autoStart'];
        assert.ok(prop, 'autoStart property should exist');
        assert.strictEqual(prop.type, 'boolean');
        assert.strictEqual(prop.default, true);
    });
});
