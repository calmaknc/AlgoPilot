import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// 最小 DOM 替身验证事件与状态，不替代真实浏览器排版检查。
class Element {
    children = [];
    events = {};
    attributes = {};
    value = '';
    textContent = '';
    disabled = false;
    hidden = false;
    classList = { toggle() {} };
    addEventListener(name, fn) { this.events[name] = fn; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    querySelector() { return this; }
    querySelectorAll() { return this.children; }
    focus() {}
    requestSubmit() { return this.fire('submit'); }
    fire(name, options = {}) { return this.events[name]?.({ preventDefault() {}, ...options }); }
}
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
function setup(fetch, storage = new Map()) {
    const nodes = new Map();
    const get = id => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
    };
    vm.runInNewContext(source, {
        document: { querySelector: get, createElement: () => new Element() }, fetch, TextDecoder, setTimeout, clearTimeout,
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    });
    return { get, storage };
}
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => structuredClone(data) });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('网页：新建、发送、禁止重复提交、恢复、错误保留输入及安全文本', async () => {
    const conversations = new Map();
    let calls = 0;
    let fail = false;
    let hold;
    let entered;
    let readsFail = false;
    const fetch = async (path, options) => {
        if (path === '/api/conversations') {
            const value = { id: 'session-' + conversations.size, title: '新会话', messages: [] };
            conversations.set(value.id, value);
            return response(value, 201);
        }
        if (path === '/api/chat/stream') {
            calls++;
            const body = JSON.parse(options.body);
            if (hold) { entered(); await hold; }
            if (fail) return response({ error: { message: '模拟模型失败' } }, 502);
            const value = conversations.get(body.conversationId);
            value.messages.push({ role: 'user', content: body.message }, { role: 'assistant', content: '<script>unsafe()</script>' });
            value.title = body.message.slice(0, 30);
            return new Response(JSON.stringify({ type: 'delta', text: '<script>unsafe()</script>' }) + '\n' + JSON.stringify({ type: 'done', conversationId: value.id, title: value.title, reply: '<script>unsafe()</script>' }) + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
        }
        if (readsFail) throw new Error('网络错误');
        return response(conversations.get(path.split('/').at(-1)));
    };
    const { get, storage } = setup(fetch);
    get('#message-input').value = '   ';
    await get('#message-form').fire('submit');
    assert.equal(calls, 0);
    get('#message-input').value = '第一问';
    await get('#message-form').fire('submit');
    assert.equal(calls, 1);
    assert.equal(get('#message-input').value, '');
    assert.match(get('#chat-title').textContent, /第一问/);
    const rendered = get('#messages').children.at(-1).children.at(-1);
    assert.equal(rendered.textContent, '<script>unsafe()</script>');
    assert.equal(rendered.innerHTML, undefined);

    const restored = setup(fetch, storage);
    await flush();
    assert.equal(restored.get('#messages').children.length, 2);
    assert.match(restored.get('#chat-id').textContent, /session-0/);

    let release;
    const started = new Promise(resolve => { entered = resolve; });
    hold = new Promise(resolve => { release = resolve; });
    get('#message-input').value = '第二问';
    const pending = get('#message-form').fire('submit');
    await started;
    assert.equal(get('#send-button').disabled, true);
    await get('#message-form').fire('submit');
    assert.equal(calls, 2);
    release();
    await pending;
    hold = null;
    assert.equal(get('#send-button').disabled, false);
    assert.equal(get('#pending').hidden, true);

    fail = true;
    get('#message-input').value = '失败时保留';
    await get('#message-form').fire('submit');
    assert.equal(get('#message-input').value, '失败时保留');
    assert.equal(get('#messages').children.length, 4);
    assert.match(get('#status').textContent, /模拟模型失败/);
    readsFail = true;
    await get('#message-form').fire('submit');
    assert.equal(get('#send-button').disabled, true);
    readsFail = false;
    await get('#refresh-history').fire('click');
    await flush();
    assert.equal(get('#send-button').disabled, false);
    await get('#new-chat').fire('click');
    assert.match(get('#chat-id').textContent, /session-1/);
    await get('#conversation-list').children[1].fire('click');
    await flush();
    assert.match(get('#chat-id').textContent, /session-0/);
});
