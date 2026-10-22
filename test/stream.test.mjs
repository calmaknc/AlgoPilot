import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentService } from '../src/agent/service.ts';
import { createExpressApp } from '../src/http/app.ts';

test('流接口：提前收到片段、工具事件、保存后 done、失败无半轮历史', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-stream-'));
    let release;
    let gate;
    const service = createAgentService({ directory: pathToFileURL(dir + '/'), runModel: async (messages, chunk, tool) => {
        chunk('你好\n');
        if (messages.at(-1).content === '失败') throw new Error('failed');
        await gate;
        tool('run_python', '{"code":"print(3)","stdin":""}', '{"ok":true,"stdout":"3\\n","executionSucceeded":true}');
        chunk('世界');
        return '你好\n世界';
    } });
    const server = createExpressApp(service).listen(0, '127.0.0.1');
    try {
        await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const conversation = await service.newConversation();
        const post = message => fetch(base + '/api/agent/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: conversation.id, message }) });
        gate = new Promise(resolve => { release = resolve; });
        const response = await post('正常');
        assert.match(response.headers.get('content-type'), /ndjson/);
        const reader = response.body.getReader();
        const first = await reader.read();
        let text = new TextDecoder().decode(first.value);
        assert.match(text, /delta/);
        assert.equal((await service.getConversation(conversation.id)).messages.length, 0);
        assert.equal((await post('并发')).status, 409);
        release();
        while (true) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
        const events = text.trim().split('\n').map(JSON.parse);
        assert.deepEqual(events.map(e => e.type), ['delta', 'tool', 'delta', 'done']);
        assert.equal(events.at(-1).reply, '你好\n世界');
        assert.deepEqual(events.at(-1).toolCalls, [{ name: 'run_python', argumentsJson: '{"code":"print(3)","stdin":""}' }]);
        assert.equal((await service.getConversation(conversation.id)).messages.length, 2);
        const failure = await post('失败');
        const failureEvents = (await failure.text()).trim().split('\n').map(JSON.parse);
        assert.deepEqual(failureEvents.map(e => e.type), ['delta', 'error']);
        assert.equal((await service.getConversation(conversation.id)).messages.length, 2);
        assert.equal((await post(' ')).status, 400);
        assert.equal((await fetch(base + '/api/agent/stream')).status, 405);
    } finally {
        release?.(); server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await rm(dir, { recursive: true, force: true });
    }
});
