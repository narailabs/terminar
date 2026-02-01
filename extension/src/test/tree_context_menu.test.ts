import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

suite('TreeView Context Menu (package.json)', () => {
    let packageJson: any;

    setup(() => {
        const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
        packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    });

    test('renameSession command is declared', () => {
        const cmds = packageJson.contributes.commands;
        const rename = cmds.find((c: any) => c.command === 'terminar.renameSession');
        assert.ok(rename, 'renameSession command should exist');
        assert.strictEqual(rename.title, 'Rename Session');
    });

    test('killSession command is declared', () => {
        const cmds = packageJson.contributes.commands;
        const kill = cmds.find((c: any) => c.command === 'terminar.killSession');
        assert.ok(kill, 'killSession command should exist');
        assert.strictEqual(kill.title, 'Kill Session');
    });

    test('context menu includes renameSession for session items', () => {
        const menus = packageJson.contributes.menus['view/item/context'];
        assert.ok(menus, 'view/item/context menus should exist');

        const renameMenu = menus.find((m: any) => m.command === 'terminar.renameSession');
        assert.ok(renameMenu, 'renameSession should be in context menu');
        assert.ok(renameMenu.when.includes('viewItem == session'), 'Should be scoped to session items');
    });

    test('context menu includes killSession for session items', () => {
        const menus = packageJson.contributes.menus['view/item/context'];
        const killMenu = menus.find((m: any) => m.command === 'terminar.killSession');
        assert.ok(killMenu, 'killSession should be in context menu');
        assert.ok(killMenu.when.includes('viewItem == session'), 'Should be scoped to session items');
    });
});
