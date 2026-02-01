import * as assert from 'assert';
import { parseLines, safeJsonParse } from '../utils';

suite('Protocol Utilities', () => {
	test('parseLines handles complete lines', () => {
		const input = '{"a":1}\n{"b":2}\n';
        const result = parseLines(input);
        assert.deepStrictEqual(result.lines, ['{"a":1}', '{"b":2}']);
        assert.strictEqual(result.remainder, '');
	});

    test('parseLines handles partial lines', () => {
		const input = '{"a":1}\n{"b":';
        const result = parseLines(input);
        assert.deepStrictEqual(result.lines, ['{"a":1}']);
        assert.strictEqual(result.remainder, '{"b":');
	});

    test('safeJsonParse returns object for valid JSON', () => {
        const obj = safeJsonParse('{"type":"test"}');
        assert.strictEqual(obj.type, 'test');
    });

    test('safeJsonParse returns null for invalid JSON', () => {
        const obj = safeJsonParse('INVALID');
        assert.strictEqual(obj, null);
    });
});
