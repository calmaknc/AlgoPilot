import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConversation, initializeConversation, appendMessages, updateConversationTitle, loadConversation, loadLastConversation } from '../src/storage/conversations.ts';

test('分离元信息与消息：只追加新增行，改标题不重写消息，恢复与排他创建', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'session-append-'));
    const directory = pathToFileURL(temporary + '/');
    const conversation = createConversation();
    const file = new URL(`conversation-${conversation.id}.jsonl`, directory);
    const meta = new URL(`conversation-${conversation.id}.meta.json`, directory);
    const first = [
        { role: 'user', content: '代码\nprint("你好😀")' },
        { role: 'assistant', content: '先运行\n再解释', toolCalls: [{ name: 'run_python', argumentsJson: '{"code":"print(1)"}', textOffset: 3 }], metrics: { durationMs: 20, modelCalls: [], usage: null } },
    ];
    try {
        assert.equal(await loadLastConversation(directory), null);
        await initializeConversation(conversation, directory);
        assert.equal(await readFile(file, 'utf8'), '');
        assert.deepEqual(JSON.parse(await readFile(meta, 'utf8')), { version: 1, id: conversation.id, title: '新会话' });
        const inode = (await stat(file)).ino;
        await appendMessages(conversation.id, first, directory);
        const original = await readFile(file, 'utf8');
        assert.deepEqual(original.trimEnd().split('\n').map(JSON.parse), first);
        await updateConversationTitle(conversation.id, '调试笔记', directory);
        assert.equal(await readFile(file, 'utf8'), original);
        const second = [{ role: 'user', content: '继续' }, { role: 'assistant', content: '第二轮' }];
        await appendMessages(conversation.id, second, directory);
        assert.equal((await stat(file)).ino, inode, '追加时不替换消息文件');
        assert.equal(await readFile(file, 'utf8'), original + second.map(x => JSON.stringify(x)).join('\n') + '\n');
        assert.deepEqual(await loadLastConversation(directory), { ...conversation, title: '调试笔记', messages: [...first, ...second] });
        const snapshot = await readFile(file, 'utf8');
        await assert.rejects(initializeConversation(conversation, directory), { code: 'EEXIST' });
        assert.equal(await readFile(file, 'utf8'), snapshot);
        await assert.rejects(loadConversation('../escape', directory), /会话 ID/);
        await assert.rejects(appendMessages('missing', first, directory), { code: 'ENOENT' });
        for (const role of ['user', 'system']) {
            for (const extra of [{ toolCalls: [] }, { metrics: { durationMs: 0, modelCalls: [], usage: null } }]) {
                await assert.rejects(appendMessages(conversation.id, [{ role, content: 'x', ...extra }], directory), /结构不正确/);
            }
        }
        assert.equal(await readFile(file, 'utf8'), snapshot);
    } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('截断与坏行阻止追加；旧历史不读取、不修改；元信息损坏报错', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'session-damaged-'));
    const directory = pathToFileURL(temporary + '/');
    const conversation = createConversation('new');
    const file = new URL('conversation-new.jsonl', directory);
    const meta = new URL('conversation-new.meta.json', directory);
    try {
        await writeFile(new URL('conversation-old.json', directory), '{"old":true}');
        await writeFile(new URL('conversation-old.jsonl', directory), '{"type":"session","version":1,"id":"old","title":"旧会话"}\n');
        await writeFile(new URL('last-session.txt', directory), 'old');
        assert.equal(await loadLastConversation(directory), null);
        await assert.rejects(loadConversation('old', directory), { code: 'ENOENT' });
        assert.equal(await readFile(new URL('conversation-old.json', directory), 'utf8'), '{"old":true}');
        await initializeConversation(conversation, directory);
        const messages = [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }];
        for (const raw of ['{broken', '{broken\n', '{"role":"user","content":"x"}', '\n', '{"role":"invalid","content":42}\n']) {
            await writeFile(file, raw);
            await assert.rejects(loadConversation(conversation.id, directory));
            await assert.rejects(appendMessages(conversation.id, messages, directory));
            assert.equal(await readFile(file, 'utf8'), raw);
        }
        await writeFile(file, messages.map(x => JSON.stringify(x)).join('\r\n') + '\r\n');
        assert.deepEqual((await loadConversation(conversation.id, directory)).messages, messages);
        await writeFile(meta, '{broken');
        await assert.rejects(loadLastConversation(directory), SyntaxError);
        const blocked = new URL('blocked', directory);
        await writeFile(blocked, 'not a directory');
        await assert.rejects(initializeConversation(createConversation(), new URL(blocked.href + '/')));
    } finally { await rm(temporary, { recursive: true, force: true }); }
});
