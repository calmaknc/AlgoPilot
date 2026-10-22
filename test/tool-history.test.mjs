import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentService } from '../src/agent/service.ts';
import { saveConversation } from '../src/storage/conversations.ts';

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
        assert.deepEqual(loaded.messages[1].toolCalls, calls);
        const raw = await readFile(join(dir, `conversation_${conversation.id}.json`), 'utf8');
        assert.equal(raw.includes('OUTPUT_MUST_NOT_BE_SAVED'), false);
        await service.run(conversation.id, '第二轮');
        await assert.rejects(service.run(conversation.id, '失败'));
        assert.equal((await service.getConversation(conversation.id)).messages.length, 4);
        loaded.messages[1].toolCalls = [{ name: 'bad', argumentsJson: 42 }];
        await assert.rejects(saveConversation(loaded, directory), /结构不正确/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
