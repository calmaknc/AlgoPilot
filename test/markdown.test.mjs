import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// 运行实际浏览器库与页面脚本，验证恢复历史和新回复使用相同的安全渲染路径。
test('Markdown 排版、代码转义、危险 HTML 清理及用户纯文本', async () => {
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost:3001', runScripts: 'outside-only' });
    try {
        for (const path of ['../node_modules/marked/lib/marked.umd.js', '../node_modules/dompurify/dist/purify.min.js']) {
            dom.window.eval(await readFile(new URL(path, import.meta.url), 'utf8'));
        }
        const markdown = '# 标题\n\n**加粗** 与 `inline`\n\n- 列表\n\n> 引用\n\n```js\n<script>alert(1)</script>\n```\n\n| 名称 | 值 |\n| --- | --- |\n| a | b |\n\n[文档](https://example.com)\n\n<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">危险链接</a><p style="position:fixed" onclick="alert(1)">内容</p>';
        const conversation = { id: 'demo', title: '示例', messages: [{ role: 'user', content: '**原样** <img src=x>' }, { role: 'assistant', content: markdown }] };
        dom.window.localStorage.setItem('mini-agent.sessions.v1', JSON.stringify({ selected: 'demo', sessions: [{ id: 'demo', title: '示例' }] }));
        dom.window.TextDecoder = TextDecoder;
        dom.window.fetch = async (path) => path === '/api/agent/stream'
            ? new Response(JSON.stringify({ type: 'delta', text: '**新回复**' }) + '\n' + JSON.stringify({ type: 'done', conversationId: 'demo', title: '示例', reply: '**新回复**' }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
            : ({ ok: true, json: async () => structuredClone(conversation) });
        dom.window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
        await new Promise(resolve => setImmediate(resolve));
        const doc = dom.window.document;
        const body = doc.querySelector('.assistant .message-body');
        assert.equal(body.querySelector('h1').textContent, '标题');
        assert.equal(body.querySelector('strong').textContent, '加粗');
        assert.ok(body.querySelector('ul li'));
        assert.ok(body.querySelector('blockquote'));
        assert.ok(body.querySelector('table td'));
        assert.equal(body.querySelector('pre code').textContent.trim(), '<script>alert(1)</script>');
        assert.equal(body.querySelector('a').getAttribute('href'), 'https://example.com');
        assert.equal(body.querySelector('script,img,[onclick],[onerror],[style]'), null);
        assert.equal(body.querySelector('a[href^="javascript:"]'), null);
        assert.equal(doc.querySelector('.user .message-body').textContent, '**原样** <img src=x>');
        assert.equal(doc.querySelector('.user img'), null);
        doc.querySelector('#message-input').value = '继续';
        doc.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal([...doc.querySelectorAll('.assistant strong')].at(-1).textContent, '新回复');
    } finally { dom.window.close(); }
});
