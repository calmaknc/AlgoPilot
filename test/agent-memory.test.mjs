import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemoryStore } from '../src/agent/memory-store.ts';
import { createAgentService } from '../src/agent/service.ts';

process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
process.env.DEEPSEEK_MODEL = 'local-test-model';
let handler;
globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.deepseek.com/responses');
    return handler(JSON.parse(options.body));
};
const { requestModel } = await import('../src/agent/runner.ts');
function stream(text, output = []) {
    const events = [
        { type: 'response.output_text.delta', delta: text },
        {
            type: 'response.completed',
            response: {
                status: 'completed',
                output,
                usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
        },
    ];
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
    });
}
function answer(value) {
    return Response.json({
        id: 'memory',
        object: 'response',
        status: 'completed',
        output: [
            {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }],
            },
        ],
        usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    });
}
async function fixture(fn) {
    const root = await mkdtemp(join(tmpdir(), 'agent-memory-'));
    try {
        await fn(pathToFileURL(root + '/'));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
const draft = {
    name: 'user-tabs',
    description: '使用 tab 缩进',
    type: 'user',
    content: '默认使用 tab。',
    evidence: '请记住用 tab',
};
const empty = { upsert: [], remove: [] };
const noTools = { toolDefinitions: [], executeTool: async () => assert.fail('不应执行工具') };

test('先提交再确认，新会话保留偏好，临时例外不写回长期记忆', async () =>
    fixture(async (directory) => {
        const store = createMemoryStore(directory),
            calls = [],
            records = [];
        handler = async (body) => {
            if (body.stream) {
                calls.push('answer');
                assert.equal((await store.read()).memories[0].content, '默认使用 tab。');
                assert.match(body.instructions, /"status":"updated"/);
                assert.match(body.input.at(-1).content, /默认使用 tab/);
                return stream('已记住。');
            }
            const data = JSON.parse(body.input[0].content);
            if ('index' in data) {
                calls.push('recall');
                return answer({ names: ['user-tabs'] });
            }
            calls.push('extract');
            return answer({ upsert: [draft], remove: [] });
        };
        await requestModel(
            [{ role: 'user', content: '请记住用 tab' }],
            undefined,
            undefined,
            undefined,
            (record) => records.push(record),
            noTools,
            { memoryDirectory: directory },
        );
        assert.deepEqual(calls, ['extract', 'recall', 'answer']);
        assert.equal(records.length, 3);
        const before = await store.read();
        handler = (body) => {
            if (body.stream) {
                assert.match(body.instructions, /"status":"unchanged"/);
                assert(body.input.at(-1).content.endsWith('当前用户要求：\n这次用四个空格'));
                return stream('本次使用四个空格。');
            }
            const data = JSON.parse(body.input[0].content);
            return answer('index' in data ? { names: ['user-tabs'] } : empty);
        };
        const messages = [{ role: 'user', content: '这次用四个空格' }];
        await requestModel(messages, undefined, undefined, undefined, undefined, noTools, {
            memoryDirectory: directory,
        });
        assert.deepEqual(messages, [{ role: 'user', content: '这次用四个空格' }]);
        assert.equal((await store.read()).revision, before.revision);
    }));

test('无效更新只修正一次，失败状态在任何回答片段之前提供给模型', async () =>
    fixture(async (directory) => {
        let attempts = 0,
            streamed = false;
        const events = [];
        handler = (body) => {
            if (body.stream) {
                assert.equal(attempts, 2);
                assert.match(body.instructions, /"status":"failed"/);
                assert.match(body.instructions, /不能说已记住/);
                return stream('记忆未能更新，本轮仍按你的要求回答。');
            }
            assert.equal(streamed, false);
            const data = JSON.parse(body.input[0].content);
            if (++attempts === 2) {
                assert.match(data.repair.validationError, /upsert和remove/);
                assert.equal(data.repair.previousOutput, '{}');
            }
            return answer({});
        };
        const reply = await requestModel(
            [{ role: 'user', content: '请记住用 tab' }],
            () => {
                streamed = true;
            },
            undefined,
            undefined,
            undefined,
            noTools,
            { memoryDirectory: directory, onMemory: (e) => events.push(e) },
        );
        assert.match(reply, /未能更新/);
        assert.equal((await createMemoryStore(directory).read()).memories.length, 0);
        assert(events.some((e) => e.phase === 'extract' && e.status === 'warning'));
    }));

test('格式修正成功后才确认，且不会重复提交', async () =>
    fixture(async (directory) => {
        let attempts = 0;
        handler = async (body) => {
            if (body.stream) {
                assert.equal(attempts, 2);
                assert.equal((await createMemoryStore(directory).read()).memories.length, 1);
                assert.match(body.instructions, /"status":"updated"/);
                return stream('已记住。');
            }
            const data = JSON.parse(body.input[0].content);
            if ('index' in data) return answer({ names: ['user-tabs'] });
            return answer(++attempts === 1 ? { upsert: [draft] } : { upsert: [draft], remove: [] });
        };
        await requestModel(
            [{ role: 'user', content: '请记住用 tab' }],
            undefined,
            undefined,
            undefined,
            undefined,
            noTools,
            { memoryDirectory: directory },
        );
        assert.equal(attempts, 2);
    }));

test('工具循环后只提取新工具事实，不再次应用用户偏好；保存原始用户文本', async () =>
    fixture(async (directory) => {
        const calls = [];
        let executed = 0;
        const tools = {
            toolDefinitions: [],
            executeTool: async () => {
                executed++;
                return '{"ok":true,"path":"src/agent/runner.ts"}';
            },
        };
        handler = (body) => {
            if (body.stream) {
                calls.push('answer');
                return executed
                    ? stream('已检查。')
                    : stream('先检查。', [
                          { type: 'function_call', call_id: 'a', name: 'test', arguments: '{}' },
                      ]);
            }
            const data = JSON.parse(body.input[0].content);
            if ('index' in data) {
                calls.push('recall');
                return answer({ names: ['user-tabs'] });
            }
            calls.push('extract');
            if (data.toolEvidence.length) {
                assert.equal(data.toolEvidence.length, 1);
                assert.equal(data.currentUser, '');
                assert.deepEqual(data.recent, []);
                return answer(empty);
            }
            return answer({ upsert: [draft], remove: [] });
        };
        const service = createAgentService({
            directory: new URL('conversations/', directory),
            runModel: (messages, onChunk, onTool, signal, onModelCall, onMemory) =>
                requestModel(messages, onChunk, onTool, signal, onModelCall, tools, {
                    memoryDirectory: new URL('memory/', directory),
                    onMemory,
                }),
        });
        const conversation = await service.newConversation();
        await service.run(conversation.id, '请记住用 tab');
        assert.deepEqual(calls, ['extract', 'recall', 'answer', 'answer', 'extract']);
        const saved = await service.getConversation(conversation.id);
        assert.equal(saved.messages[0].content, '请记住用 tab');
        assert.equal(saved.messages[1].metrics.modelCalls.length, 5);
    }));

test('服务故障不自动重试；取消不能撤销已提交记忆，取消前不提取工具结果', async () =>
    fixture(async (directory) => {
        let attempts = 0;
        handler = (body) => {
            if (body.stream) {
                assert.match(body.instructions, /"status":"failed"/);
                return stream('无法保存记忆。');
            }
            attempts++;
            return Response.json({ error: { message: 'unavailable' } }, { status: 503 });
        };
        await requestModel(
            [{ role: 'user', content: '请记住用 tab' }],
            undefined,
            undefined,
            undefined,
            undefined,
            noTools,
            { memoryDirectory: directory },
        );
        assert.equal(attempts, 1);
        const controller = new AbortController();
        handler = (body) => {
            if (body.stream) return stream('部分回答');
            const data = JSON.parse(body.input[0].content);
            return answer(
                'index' in data ? { names: ['user-tabs'] } : { upsert: [draft], remove: [] },
            );
        };
        await assert.rejects(
            requestModel(
                [{ role: 'user', content: '请记住用 tab' }],
                () => controller.abort(),
                undefined,
                controller.signal,
                undefined,
                noTools,
                { memoryDirectory: directory },
            ),
            { name: 'AbortError' },
        );
        assert.equal((await createMemoryStore(directory).read()).memories.length, 1);
    }));
