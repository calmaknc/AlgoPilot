import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('网页流：UTF-8 拆包、中途显示、工具卡片、done 确认与截断错误', async () => {
    const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://localhost', runScripts: 'outside-only' });
    const note = { id: 'stream-test', title: '新会话', messages: [] };
    let controller;
    const encode = new TextEncoder();
    const tick = () => new Promise(resolve => setTimeout(resolve, 65));
    try {
        dom.window.TextDecoder = TextDecoder;
        dom.window.fetch = async (path, options) => {
            if (path === '/api/agent/stream') return new Response(new ReadableStream({ start(c) { controller = c; options.signal.addEventListener('abort', () => c.error(options.signal.reason), { once: true }); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
            return { ok: true, json: async () => structuredClone(note) };
        };
        dom.window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
        const doc = dom.window.document;
        doc.querySelector('#message-input').value = '运行代码';
        doc.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
        await tick();
        const send = event => {
            const bytes = encode.encode(JSON.stringify(event) + '\n');
            // 每字节拆分，覆盖中文 UTF-8 和 JSON 跨块。
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        };
        send({ type: 'delta', text: '你好' });
        await tick();
        assert.equal(doc.querySelector('.assistant .message-body').textContent, '你好');
        assert.equal(doc.querySelector('#send-button').disabled, true);
        send({ type: 'tool', name: 'run_python', argumentsJson: '{"code":"print(3)"}', output: '{"ok":true,"executionSucceeded":true,"stdout":"<script>bad()</script>"}' });
        await tick();
        assert.equal(doc.querySelector('#tool-panel').hidden, false);
        assert.match(doc.querySelector('.tool-card summary').textContent, /run_python/);
        assert.match(doc.querySelector('.tool-card pre').textContent, /<script>/);
        assert.equal(doc.querySelector('.tool-card script'), null);
        send({ type: 'done', conversationId: note.id, title: '运行代码', reply: '你好，结果是 3' });
        await tick();
        assert.equal(doc.querySelector('#status').textContent, '回答已保存。');
        assert.equal(doc.querySelector('#send-button').disabled, false);
        assert.equal(doc.querySelector('.assistant .message-body').textContent, '你好，结果是 3');
        assert.equal(doc.querySelector('#tool-panel').hidden, false);
        doc.querySelector('#message-input').value = '断流测试';
        doc.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
        await tick();
        send({ type: 'delta', text: '未完成' });
        controller.close();
        await tick();
        assert.match(doc.querySelector('#status').textContent, /连接提前结束/);
        assert.equal(doc.querySelector('#message-input').value, '断流测试');
        assert.equal(doc.querySelector('#send-button').disabled, false);
        doc.querySelector('#message-input').value = '取消测试';
        doc.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
        await tick();
        send({ type: 'delta', text: '保留部分' });
        await tick();
        doc.querySelector('#stop-button').click();
        doc.querySelector('#stop-button').click();
        await tick();
        assert.match(doc.querySelector('.assistant .message-body').textContent, /保留部分.*\n.*已停止/s);
        assert.match(doc.querySelector('#status').textContent, /已停止/);
        assert.equal(doc.querySelector('#status').classList.contains('error'), false);
        assert.equal(doc.querySelector('#stop-button').hidden, true);
        assert.equal(doc.querySelector('#send-button').disabled, false);
        assert.equal(doc.querySelector('#message-input').value, '取消测试');
    } finally { dom.window.close(); }
});
