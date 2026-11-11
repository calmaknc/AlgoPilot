import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentService } from '../src/agent/service.ts';
import { AppError } from '../src/shared/errors.ts';

test('执行失败保留底层原因及业务错误码，不暗示工具写入回滚', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-errors-'));
    let failure = Object.assign(new Error('upstream connection reset'), { code: 'ECONNRESET' });
    const service = createAgentService({ directory: pathToFileURL(dir + '/'), runModel: async () => { throw failure; } });
    try {
        const conversation = await service.newConversation();
        await assert.rejects(service.run(conversation.id, '测试'), error => {
            assert.equal(error.code, 'MODEL_ERROR');
            assert.equal(error.cause, failure);
            assert.match(error.message, /upstream connection reset/);
            assert.match(error.message, /不会回滚/);
            return true;
        });
        failure = new AppError(502, 'FINAL_REPLY_TOOL_CALL', '最后回复轮仍请求工具');
        await assert.rejects(service.run(conversation.id, '重试'), error => error === failure);
        assert.equal((await service.getConversation(conversation.id)).messages.length, 0);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
