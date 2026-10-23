import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebClient, WEB_LIMITS } from '../src/tools/web-client.ts';
import { createWebSearchTool, createReadWebpageTool } from '../src/tools/implementations.ts';
import { createToolRegistry } from '../src/tools/registry.ts';
const json = data => new Response(JSON.stringify(data));
const result = { title: '题目', url: 'https://leetcode.cn/problems/two-sum/', summary: '摘要', content: '正文' };

test('网页工具：独立鉴权接口、参数校验、正文截断及每次请求不缓存', async () => {
    const requests = [];
    const client = createWebClient({ apiKey: () => 'test-key', fetch: async (url, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        assert.equal(options.redirect, 'error');
        requests.push({url, body: JSON.parse(options.body)});
        return url.endsWith('/search') ? json({ results: [{ ...result, content: '中'.repeat(9000) }] })
            : json({ title: '题目', content: '中'.repeat(25000) });
    } });
    const registry = createToolRegistry([createWebSearchTool(client), createReadWebpageTool(client)]);
    const run = async (name, args, signal) => JSON.parse(await registry.executeTool(name, JSON.stringify(args), signal));
    const search = await run('web_search', {query:'😀'.repeat(128)});
    assert.equal(search.ok, true);
    assert.equal(search.results[0].content.length, 8000);
    assert.equal(search.results[0].contentTruncated, true);
    assert.deepEqual(requests[0].body, {query:'😀'.repeat(128), count:5, need_content:true});
    assert.equal(requests[0].url, 'https://api.deepseek.com/v1/tools/search');
    const page = await run('read_webpage', {url: result.url});
    assert.equal(page.content.length, 24000);
    assert.equal(page.contentTruncated, true);
    await run('read_webpage', {url: result.url});
    assert.equal(requests.length, 3, '同一 URL 重复调用仍发送请求');
    for (const args of [{query:''}, {query:'x'.repeat(129)}, {query:'x', extra:1}, {query:42}]) {
        assert.equal((await run('web_search', args)).ok, false);
    }
    for (const url of ['file:///etc/passwd', 'https://user:secret@example.com', 'invalid', 'https://a.com/' + 'a'.repeat(8192)]) {
        assert.equal((await run('read_webpage', {url})).ok, false);
    }
    assert.equal(requests.length, 3);
});

test('网页工具：无结果、空正文、坏结构、HTTP 错误、响应大小上限', async () => {
    let reply = () => json({results:[]});
    const client = createWebClient({ apiKey: () => 'test', fetch: async () => reply() });
    assert.deepEqual((await client.search('x')).results, []);
    reply = () => json({results:[{...result, content:''}]});
    assert.equal((await client.search('x')).results[0].contentAvailable, false);
    reply = () => json({title:'', content:''});
    await assert.rejects(client.readPage(result.url), /未能获取网页正文/);
    reply = () => json({results:[{title:'bad'}]});
    await assert.rejects(client.search('x'), /结构不正确/);
    reply = () => new Response('{');
    await assert.rejects(client.search('x'), /无效 JSON/);
    reply = () => new Response('secret upstream body', {status:429});
    await assert.rejects(client.search('x'), error => /429/.test(error.message) && !error.message.includes('secret'));
    reply = () => new Response('x'.repeat(WEB_LIMITS.responseBytes + 1));
    await assert.rejects(client.search('x'), /大小限制/);
});

test('网页工具：超时覆盖响应流，用户取消向上抛出', async () => {
    const client = createWebClient({ apiKey: () => 'test', timeoutMs: 15, fetch: async (_url, options) =>
        new Response(new ReadableStream({ start(controller) {
            options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once:true });
        } })) });
    await assert.rejects(client.search('x'), /超时/);
    const controller = new AbortController();
    const pending = client.search('x', controller.signal);
    controller.abort(new Error('用户取消'));
    await assert.rejects(pending, /用户取消/);
});
