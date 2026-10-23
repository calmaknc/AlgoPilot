import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentService } from '../src/agent/service.ts';
import { appendMessages } from '../src/storage/conversations.ts';

test('工具历史：保存名称与参数、兼容旧会话、不回传模型、不保存失败轮次', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tool-history-'));
    const directory = pathToFileURL(dir + '/');
    const calls = [{ name: 'run_python', argumentsJson: '{"code":"print(1)"}' }, { name: 'search_practice_notes', argumentsJson: '{"query":"二分"}' }];
    const service = createAgentService({ directory, runModel: async (messages, chunk, tool) => {
        assert.ok(messages.every(message => !('toolCalls' in message)));
        for (const call of calls) tool(call.name, call.argumentsJson, 'OUTPUT_MUST_NOT_BE_SAVED');
        if (messages.at(-1).content === '失败') throw new Error('failed');
        return '完成';
    } });
    try {
        const conversation = await service.newConversation();
        assert.deepEqual((await service.getConversation(conversation.id)).messages, []);
        await service.run(conversation.id, '第一轮');
        const loaded = await service.getConversation(conversation.id);
        assert.deepEqual(loaded.messages[1].toolCalls, calls.map(call => ({ ...call, textOffset: 0 })));
        const raw = await readFile(join(dir, `conversation-${conversation.id}.jsonl`), 'utf8');
        assert.equal(raw.includes('OUTPUT_MUST_NOT_BE_SAVED'), false);
        await service.run(conversation.id, '第二轮');
        await assert.rejects(service.run(conversation.id, '失败'));
        assert.equal((await service.getConversation(conversation.id)).messages.length, 4);
        loaded.messages[1].toolCalls = [{ name: 'bad', argumentsJson: 42 }];
        await assert.rejects(appendMessages(loaded.id, loaded.messages, directory), /结构不正确/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});


test('每轮统计：多次模型用量累加、缺失用量不记零、重载与数据校验', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'turn-metrics-'));
    const directory = pathToFileURL(dir + '/');
    const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120 };
    const record = { name: 'run_python', argumentsJson: '{"code":"print(1)"}', callId: 'python-1', round: 1, durationMs: 15, status: 'error', resultStatus: '执行未成功：timeout' };
    const service = createAgentService({ directory, runModel: async (messages, chunk, tool, signal, model) => {
        assert.ok(messages.every(message => !('metrics' in message) && !('toolCalls' in message)));
        model({ round: 1, durationMs: 30, usage });
        tool(record.name, record.argumentsJson, '{"ok":true,"status":"timeout"}', record);
        model({ round: 2, durationMs: 40, usage: messages.at(-1).content === '缺失' ? null : usage });
        return '已完成分析';
    } });
    try {
        const conversation = await service.newConversation();
        await service.run(conversation.id, '完整');
        const loaded = await service.getConversation(conversation.id);
        assert.deepEqual(loaded.messages[1].toolCalls, [{ ...record, textOffset: 0 }]);
        assert.deepEqual(loaded.messages[1].metrics.usage, { inputTokens: 200, outputTokens: 40, totalTokens: 240 });
        assert.equal(loaded.messages[1].metrics.modelCalls.length, 2);
        assert.ok(loaded.messages[1].metrics.durationMs >= 0);
        await service.run(conversation.id, '缺失');
        assert.equal((await service.getConversation(conversation.id)).messages[3].metrics.usage, null);
        for (const mutate of [
            message => { message.metrics.usage.inputTokens = -1; },
            message => { message.metrics.modelCalls[0].round = 0; },
            message => { message.toolCalls[0].durationMs = -1; },
            message => { message.toolCalls[0].status = 'passed'; },
        ]) {
            const broken = structuredClone(loaded);
            mutate(broken.messages[1]);
            await assert.rejects(appendMessages(broken.id, broken.messages, directory), /结构不正确/);
        }
    } finally { await rm(dir, { recursive: true, force: true }); }
});


test('工具位置随历史保存，多次文字与工具交替，旧元数据不进入模型', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tool-position-'));
    const service = createAgentService({ directory: pathToFileURL(dir + '/'), runModel: async (messages, chunk, tool) => {
        chunk('先检查😀');
        tool('run_python', '{}', '{"ok":true}');
        tool('get_current_time', '{}', '{"ok":true}');
        chunk('发现问题');
        tool('run_python', '{}', '{"ok":true}');
        chunk('最终说明');
        return '先检查😀发现问题最终说明';
    } });
    try {
        const conversation = await service.newConversation();
        await service.run(conversation.id, '调试');
        const message = (await service.getConversation(conversation.id)).messages[1];
        assert.deepEqual(message.toolCalls.map(call => call.textOffset), [5, 5, 9]);
        assert.equal(message.content.slice(5, 9), '发现问题');
    } finally { await rm(dir, { recursive: true, force: true }); }
});
