import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpressApp } from '../src/http/app.ts';
import { createAgentService } from '../src/agent/service.ts';

test('Express 路由、错误响应、会话与网页', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mini-express-'));
    let release;
    let started;
    let gate;
    const service = createAgentService({
        directory: pathToFileURL(directory + '/'),
        runModel: async (messages) => {
            const message = messages.at(-1).content;
            if (message === '失败') throw new Error('模拟模型失败');
            if (message === '等待') { started(); await gate; }
            return `模拟回复：${message}`;
        },
    });
    const server = createExpressApp(service).listen(0, '127.0.0.1');
    try {
        await new Promise((resolve, reject) => {
            server.once('listening', resolve);
            server.once('error', reject);
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        async function check(path, options, status, code) {
            const response = await fetch(base + path, options);
            assert.equal(response.status, status, path);
            const body = await response.json();
            if (code) assert.equal(body.error.code, code);
            return body;
        }
        assert.match(await (await fetch(base + '/')).text(), /message-form/);
        for (const asset of ['/app.js', '/style.css', '/vendor/marked.js', '/vendor/purify.js']) assert.equal((await fetch(base + asset)).status, 200);
        await check('/health', {}, 200);
        await check('/api/info', {}, 200);
        assert.deepEqual(await check('/api/echo?x=1', json({ message: ' 你好 ' }), 200), { received: '你好' });
        await check('/api/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, 400, 'INVALID_JSON');
        await check('/api/echo', json({ message: 'a'.repeat(70000) }), 413, 'TOO_LONG_BODY_BYTES');
        await check('/api/echo', { method: 'POST', body: '{}' }, 415, 'UNSUPPORTED_MEDIA_TYPE');
        await check('/api/echo', json([]), 400, 'INVALID_BODY');
        await check('/api/echo', json({ message: ' ' }), 400, 'INVALID_MESSAGE');
        const wrongMethod = await fetch(base + '/api/agent/run');
        assert.equal(wrongMethod.status, 405);
        assert.equal(wrongMethod.headers.get('allow'), 'POST');
        await check('/missing', {}, 404, 'NOT_FOUND');
        await check('/api/conversations/%ZZ', {}, 400, 'INVALID_PATH');
        const conversation = await check('/api/conversations', json({ title: '测试' }), 201);
        const path = '/api/conversations/' + conversation.id;
        await check('/api/conversations/missing', {}, 404, 'CONVERSATION_NOT_FOUND');
        const send = (message) => json({ conversationId: conversation.id, message });
        for (const message of ['第一轮', '第二轮']) await check('/api/agent/run', send(message), 200);
        assert.equal((await check(path, {}, 200)).messages.length, 4);
        await check('/api/agent/run', send('失败'), 502, 'MODEL_ERROR');
        assert.equal((await check(path, {}, 200)).messages.length, 4);
        const entered = new Promise(resolve => { started = resolve; });
        gate = new Promise(resolve => { release = resolve; });
        const pending = check('/api/agent/run', send('等待'), 200);
        try {
            await entered;
            await check('/api/agent/run', send('冲突'), 409, 'CONVERSATION_BUSY');
        } finally { release(); }
        await pending;
        assert.equal((await check(path, {}, 200)).messages.length, 6);
    } finally {
        release?.();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await rm(directory, { recursive: true, force: true });
    }
});
