import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxService } from '../src/sandbox/service.ts';
import { createPythonTool } from '../src/tools/implementations.ts';
import { createToolRegistry } from '../src/tools/registry.ts';
import { createExpressApp } from '../src/http/app.ts';

const result = (extra = {}) => ({ status: 'completed', stdout: '3\n', stderr: '', exitCode: 0, durationMs: 10, ...extra });

test('HTTP 和工具共用沙箱：校验、结果、并发、故障及清理失败闭锁', async () => {
    let mode = 'normal';
    let release;
    let entered;
    let gate;
    let count = 0;
    const sandbox = createSandboxService(async input => {
        count++;
        assert.equal(typeof input.stdin, 'string');
        if (mode === 'hold') { entered(); await gate; }
        if (mode === 'runtime') return result({ exitCode: 1, stdout: '', stderr: 'ValueError' });
        if (mode === 'timeout') return result({ status: 'timeout', exitCode: null });
        if (mode === 'infra') return result({ status: 'infrastructure_error', exitCode: null, error: 'Docker unavailable' });
        if (mode === 'cleanup') return result({ status: 'infrastructure_error', exitCode: null, cleanupError: 'remaining container' });
        return result();
    });
    const registry = createToolRegistry([createPythonTool(sandbox)]);
    const tool = args => registry.executeTool('run_python', JSON.stringify(args)).then(JSON.parse);
    const server = createExpressApp(undefined, sandbox).listen(0, '127.0.0.1');
    try {
        await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
        const base = `http://127.0.0.1:${server.address().port}/api/sandbox/run`;
        const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        for (const body of [{ code: '' }, { code: 'x\0y' }, { code: 'pass', image: 'other' }, { code: 'pass', stdin: 12 }, { code: '中'.repeat(12000) }]) {
            assert.equal((await post(body)).status, 400);
        }
        assert.equal(count, 0);
        assert.equal((await fetch(base)).status, 405);
        assert.equal((await fetch(base, { method: 'POST', body: '{}' })).status, 415);
        assert.equal((await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
        assert.equal((await post({ code: 'x'.repeat(70000) })).status, 413);
        assert.equal((await post({ code: 'print(1+2)' })).status, 200);
        assert.equal((await tool({ code: 'print(1+2)', stdin: '' })).executionSucceeded, true);
        assert.equal((await tool({ code: '' })).ok, false);
        mode = 'runtime';
        const runtime = await tool({ code: 'raise ValueError()', stdin: '' });
        assert.equal(runtime.ok, true);
        assert.equal(runtime.executionSucceeded, false);
        assert.equal(runtime.exitCode, 1);
        mode = 'timeout';
        const timeout = await post({ code: 'while True: pass' });
        assert.equal(timeout.status, 200);
        assert.equal((await timeout.json()).status, 'timeout');
        mode = 'infra';
        assert.equal((await post({ code: 'pass' })).status, 503);
        assert.equal((await tool({ code: 'pass' })).executionSucceeded, false);
        mode = 'hold';
        const started = new Promise(resolve => { entered = resolve; });
        gate = new Promise(resolve => { release = resolve; });
        const pending = post({ code: 'pass' });
        try {
            await started;
            assert.equal((await post({ code: 'pass' })).status, 429);
            const busy = await tool({ code: 'pass' });
            assert.equal(busy.ok, false);
            assert.match(busy.error, /其他任务/);
        } finally { release(); }
        assert.equal((await pending).status, 200);
        mode = 'normal';
        assert.equal((await post({ code: 'pass' })).status, 200);
        mode = 'cleanup';
        assert.equal((await post({ code: 'pass' })).status, 503);
        const previous = count;
        const blocked = await post({ code: 'pass' });
        assert.equal(blocked.status, 503);
        assert.equal((await blocked.json()).error.code, 'SANDBOX_CLEANUP_REQUIRED');
        assert.equal(count, previous);
    } finally {
        release?.();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
