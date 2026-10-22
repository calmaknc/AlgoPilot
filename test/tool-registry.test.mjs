import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolRegistry } from '../src/tools/registry.ts';

function define(name, execute) {
    return {
        definition: { type: 'function', name, description: name, parameters: {}, strict: false },
        execute
    };
}

test('新增不同参数结构的同步和异步工具，不修改分派器', async () => {
    const { toolDefinitions, executeTool } = createToolRegistry([
        define('add', args => {
            if (typeof args?.a !== 'number' || typeof args?.b !== 'number') {
                throw new Error('需要两个数字');
            }
            return { total: args.a + args.b };
        }),
        define('async_echo', async args => ({ value: args.value })),
        define('async_failure', async () => { throw new Error('异步失败'); })
    ]);
    assert.deepEqual(toolDefinitions.map(tool => tool.name), ['add', 'async_echo', 'async_failure']);
    assert.deepEqual(JSON.parse(await executeTool('add', '{"a":2,"b":3}')), { ok: true, total: 5 });
    assert.deepEqual(JSON.parse(await executeTool('async_echo', '{"value":"hello"}')), { ok: true, value: 'hello' });
    assert.equal(JSON.parse(await executeTool('add', '{"a":"2"}')).error, '需要两个数字');
    assert.equal(JSON.parse(await executeTool('add', '{')).ok, false);
    assert.equal(JSON.parse(await executeTool('async_failure', '{}')).error, '异步失败');
    for (const name of ['unknown', 'toString', '__proto__']) {
        assert.equal(JSON.parse(await executeTool(name, '{}')).ok, false);
    }
});

test('重复工具名在初始化时失败，避免静默覆盖', () => {
    assert.throws(() => createToolRegistry([
        define('same', () => ({})), define('same', () => ({}))
    ]), /工具名重复/);
});
