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
        assert.equal(doc.querySelector('#tool-panel'), null);
        assert.match(doc.querySelector('.tool-card summary').textContent, /run_python/);
        assert.match(doc.querySelector('.tool-card pre').textContent, /<script>/);
        assert.equal(doc.querySelector('.tool-card script'), null);
        send({ type: 'done', conversationId: note.id, title: '运行代码', reply: '你好，结果是 3' });
        await tick();
        assert.equal(doc.querySelector('#status').textContent, '回答已保存。');
        assert.equal(doc.querySelector('#send-button').disabled, false);
        assert.equal(doc.querySelector('.assistant .message-body').textContent, '你好，结果是 3');
        assert.equal(doc.querySelector('#tool-panel'), null);
        assert.equal(doc.querySelector('#tool-events'), null);
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


test('网页按文字→工具→文字排列，末尾仅汇总，刷新后顺序不变', async () => {
    const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://localhost', runScripts: 'outside-only' });
    const usage = { inputTokens: 30, outputTokens: 4, totalTokens: 34 };
    const call = { name: 'run_python', argumentsJson: '{"code":"<script>bad()</script>"}', textOffset: 4, callId: 'python-1', round: 1, status: 'error', resultStatus: '执行未成功：completed（退出码 1）', durationMs: 123 };
    const metrics = { durationMs: 500, usage, modelCalls: [{ round: 1, durationMs: 200, usage }] };
    const conversation = { id: 'stats', title: '统计', messages: [{ role: 'assistant', content: '旧回复', toolCalls: [{ name: 'get_current_time', argumentsJson: '{}' }] }] };
    const tick = () => new Promise(resolve => setTimeout(resolve, 65));
    let controller;
    const send = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
    try {
        dom.window.TextDecoder = TextDecoder;
        dom.window.localStorage.setItem('mini-agent.sessions.v1', JSON.stringify({ selected: conversation.id, sessions: [] }));
        dom.window.fetch = async path => {
            if (path === '/api/agent/stream') return new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
            return { ok: true, json: async () => structuredClone(conversation) };
        };
        dom.window.eval(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
        const doc = dom.window.document;
        await tick();
        assert.match(doc.querySelector('.tool-card').textContent, /未记录结果状态/);
        doc.querySelector('#message-input').value = '调试';
        doc.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
        await tick();
        send({ type: 'delta', text: '先查代码' });
        send({ type: 'model', ...metrics.modelCalls[0] });
        send({ type: 'tool', ...call, output: '{"ok":true,"exitCode":1}' });
        await tick();
        let body = [...doc.querySelectorAll('.assistant .message-body')].at(-1);
        assert.equal(body.children[0].textContent, '先查代码');
        assert.equal(body.children[1].className, 'tool-card');
        body.querySelector('summary').click();
        send({ type: 'delta', text: '最后说明' });
        await tick();
        assert.equal(body.children[2].textContent, '最后说明');
        assert.equal(body.querySelector('details').open, true, '文字更新不应重建或收起已有工具卡片');
        assert.equal(doc.querySelector('#tool-panel'), null);
        conversation.messages.push({ role: 'user', content: '调试' }, { role: 'assistant', content: '先查代码最后说明', toolCalls: [call], metrics });
        send({ type: 'done', conversationId: conversation.id, title: conversation.title, reply: '先查代码最后说明', toolCalls: [call], metrics });
        await tick();
        const verify = () => {
            const body = [...doc.querySelectorAll('.assistant .message-body')].at(-1);
            assert.deepEqual([...body.children].map(node => node.className), ['model-text', 'tool-card', 'model-text', 'turn-summary']);
            assert.equal(body.children[0].textContent, '先查代码');
            assert.equal(body.children[2].textContent, '最后说明');
            assert.match(body.children[3].textContent, /总耗时 500 ms.*输入 30.*输出 4.*合计 34/);
            assert.match(body.querySelector('.tool-card summary').textContent, /退出码 1.*123 ms/);
            assert.equal(body.querySelector('script'), null);
            assert.equal(doc.querySelector('.tool-round'), null);
        };
        verify();
        doc.querySelector('#refresh-history').click();
        await tick();
        verify();
    } finally { dom.window.close(); }
});

test('记忆更新状态可见，回答保存后仍保留记忆失败警告',async()=>{
    const dom=new JSDOM(await readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'http://localhost',runScripts:'outside-only'});
    let controller;const tick=()=>new Promise(resolve=>setTimeout(resolve,65));
    try {
        dom.window.TextDecoder=TextDecoder;
        dom.window.fetch=async path=>path==='/api/agent/stream'
            ?new Response(new ReadableStream({start(value){controller=value;}}),{headers:{'Content-Type':'application/x-ndjson'}})
            :{ok:true,json:async()=>({id:'memory-status',title:'新会话',messages:[]})};
        dom.window.eval(await readFile(new URL('../public/app.js',import.meta.url),'utf8'));
        const doc=dom.window.document;doc.querySelector('#message-input').value='请记住用 tab';
        doc.querySelector('#message-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await tick();
        const send=value=>controller.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));
        send({type:'delta',text:'将记录'});
        send({type:'memory',phase:'extract',status:'running',message:'正在总结本轮记忆…'});await tick();
        assert.equal(doc.querySelector('#status').textContent,'正在总结本轮记忆…');
        const warning={phase:'extract',status:'warning',message:'本轮记忆更新未完成，请重试“记住…”'};
        send({type:'memory',...warning});
        send({type:'done',conversationId:'memory-status',reply:'将记录',memoryEvents:[warning]});await tick();
        assert.match(doc.querySelector('#status').textContent,/回答已保存。.*记忆更新未完成/);
        assert.equal(doc.querySelector('#status').classList.contains('error'),true);
        assert.equal(doc.querySelector('#message-input').value,'');
    } finally {dom.window.close();}
});
