import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConversation, loadConversation, loadLastConversation, saveConversation } from '../src/storage/conversations.ts';

test('会话保存、重新加载、切换、损坏与写入失败', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'mini-fastgpt-session-'));
    const directory = pathToFileURL(`${temporary}/data/`);
    try {
        const first = await loadLastConversation(directory);
        assert.deepEqual(first.messages, []);
        first.title = '学习 TypeScript';
        first.messages.push({ role: 'user', content: '我叫小明' });
        await saveConversation(first, directory);
        assert.deepEqual(await loadLastConversation(directory), first);
        assert.deepEqual(await loadConversation(first.id, directory), first);

        const second = createConversation();
        assert.notEqual(first.id, second.id);
        await saveConversation(second, directory);
        assert.deepEqual(await loadLastConversation(directory), second);
        assert.deepEqual(await loadConversation(first.id, directory), first);

        await assert.rejects(loadConversation('missing', directory), { code: 'ENOENT' });
        await assert.rejects(loadConversation('../escape', directory), /会话 ID/);
        const file = new URL(`conversation_${second.id}.json`, directory);
        await writeFile(file, '{broken');
        await assert.rejects(loadLastConversation(directory), SyntaxError);
        assert.equal(await readFile(file, 'utf8'), '{broken');

        await writeFile(file, JSON.stringify({ ...second, messages: [{ role: 'invalid', content: 42 }] }));
        await assert.rejects(loadLastConversation(directory), /结构不正确/);
        await writeFile(new URL('last-session.txt', directory), 'missing');
        await assert.rejects(loadLastConversation(directory), { code: 'ENOENT' });

        const blocked = pathToFileURL(`${temporary}/blocked`);
        await writeFile(blocked, 'not a directory');
        await assert.rejects(saveConversation(first, new URL(`${blocked.href}/`)));
    } finally {
        await rm(temporary, { recursive: true, force: true });
    }
});
