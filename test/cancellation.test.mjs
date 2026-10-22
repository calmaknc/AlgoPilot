import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentService } from '../src/agent/service.ts';
import { createExpressApp } from '../src/http/app.ts';
import { createToolRegistry } from '../src/tools/registry.ts';

test('取消：HTTP 断开传到模型、不保存半轮、释放会话锁、工具不吞取消', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cancel-'));
    let aborted;
    const observed = new Promise(resolve => { aborted = resolve; });
    const service = createAgentService({ directory: pathToFileURL(dir + '/'),
        runModel: async (messages, chunk, tool, signal) => {
            if (messages.at(-1).content === '完成') return '完成';
            chunk('部分');
            try { await delay(10000, null, { signal }); }
            finally { aborted(signal.aborted); }
            return '不应保存';
        }
    });
    const server = createExpressApp(service).listen(0, '127.0.0.1');
    try {
        await new Promise(resolve => server.once('listening', resolve));
        const conversation = await service.newConversation();
        const controller = new AbortController();
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/agent/stream`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId: conversation.id, message: '取消' }), signal: controller.signal
        });
        await response.body.getReader().read();
        controller.abort();
        assert.equal(await observed, true);
        await delay(20);
        assert.equal((await service.getConversation(conversation.id)).messages.length, 0);
        assert.equal((await service.run(conversation.id, '完成')).reply, '完成');
        await assert.rejects(service.run(conversation.id, '取消', { signal: controller.signal }), { name: 'AbortError' });
        const registry = createToolRegistry([{ definition: { name: 'cancel', type: 'function', parameters: {}, strict: false },
            execute: () => { throw new Error('应保留取消原因'); } }]);
        await assert.rejects(registry.executeTool('cancel', '{}', controller.signal), { name: 'AbortError' });
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await rm(dir, { recursive: true, force: true });
    }
});
