import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createToolRegistry } from '../src/tools/registry.ts';
import { toolDefinitions } from '../src/tools/index.ts';
import { createDeletePracticeNoteTool, createExportPracticeNoteTool, createSavePracticeNoteTool, createGetPracticeNoteTool, createUpdatePracticeNoteTool, createSearchPracticeNotesTool } from '../src/tools/implementations.ts';

test('刷题笔记工具：保存→组合搜索→读取→修改，参数、损坏文件和取消处理', async () => {
    const root = await mkdtemp(join(tmpdir(), 'practice-tools-'));
    const directory = pathToFileURL(root + '/notes/');
    const { executeTool } = createToolRegistry([createSavePracticeNoteTool(directory), createGetPracticeNoteTool(directory), createUpdatePracticeNoteTool(directory), createSearchPracticeNotesTool(directory), createDeletePracticeNoteTool(directory), createExportPracticeNoteTool(directory, pathToFileURL(root + '/exports/'))]);
    const call = async (name, args) => JSON.parse(await executeTool(name, JSON.stringify(args)));
    const note = { title: '两数之和', problem: { number: 1 }, content: '查询补数\n  # 原样保留\n', tags: ['Hash'] };
    try {
        for (const name of ['save_practice_note', 'get_practice_note', 'update_practice_note', 'search_practice_notes', 'delete_practice_note', 'export_practice_note_markdown']) assert.ok(toolDefinitions.some(t => t.name === name));
        assert.deepEqual(await call('search_practice_notes', {}), { ok: true, matches: [], total: 0 });
        const saved = await call('save_practice_note', { note });
        assert.equal(saved.ok, true);
        const found = await call('search_practice_notes', { query: '补数', tag: 'hash', number: 1, limit: 1 });
        assert.equal(found.total, 1);
        assert.equal(found.matches[0].id, saved.id);
        assert.equal('original' in found.matches[0], false);
        assert.equal((await call('search_practice_notes', { number: 2 })).total, 0);
        const loaded = await call('get_practice_note', { id: saved.id });
        assert.equal(loaded.note.content, note.content);
        const updated = await call('update_practice_note', { id: saved.id, note: { appendContent: '\n先查询后插入' } });
        assert.equal(updated.ok, true);
        assert.equal(updated.createdAt, saved.createdAt);
        assert.equal((await call('get_practice_note', { id: saved.id })).note.content, note.content + '\n先查询后插入');
        assert.equal((await call('search_practice_notes', {})).total, 1);
        for (const args of [{ limit: 21 }, { number: -1 }, { tag: '' }, { query: null }, { extra: 1 }]) assert.equal((await call('search_practice_notes', args)).ok, false);
        assert.equal((await call('get_practice_note', { id: '../outside' })).ok, false);
        assert.equal((await call('get_practice_note', { id: 'missing' })).ok, false);
        assert.equal((await call('save_practice_note', { note: {} })).ok, false);
        assert.equal((await call('update_practice_note', { id: saved.id, note: {} })).ok, false);
        assert.equal((await call('get_practice_note', { id: saved.id })).note.content, note.content + '\n先查询后插入');
        const controller = new AbortController(); controller.abort();
        await assert.rejects(executeTool('save_practice_note', JSON.stringify({ note }), controller.signal), { name: 'AbortError' });
        assert.equal((await call('search_practice_notes', {})).total, 1);
        const exported = await call('export_practice_note_markdown', { id: saved.id });
        assert.equal(exported.ok, true);
        const markdown = await readFile(exported.path, 'utf8');
        assert.equal(markdown, '# 1. 两数之和\n\n' + note.content + '\n先查询后插入');
        assert.match(markdown, /先查询后插入/);
        assert.equal(exported.bytes, Buffer.byteLength(markdown));
        const again = await call('export_practice_note_markdown', { id: saved.id });
        assert.notEqual(again.filename, exported.filename);
        for (const name of ['delete_practice_note', 'export_practice_note_markdown']) {
            assert.equal((await call(name, { id: '../outside' })).ok, false);
            assert.equal((await call(name, { id: 'missing' })).ok, false);
            assert.equal((await call(name, { id: saved.id, path: '/tmp/unsafe' })).ok, false);
            await assert.rejects(executeTool(name, JSON.stringify({ id: saved.id }), controller.signal), { name: 'AbortError' });
        }
        assert.equal((await readdir(join(root, 'exports'))).length, 2);
        assert.equal((await call('delete_practice_note', { id: saved.id })).deleted, true);
        assert.equal((await call('delete_practice_note', { id: saved.id })).ok, false);
        assert.equal((await call('get_practice_note', { id: saved.id })).ok, false);
        assert.equal((await call('search_practice_notes', {})).total, 0);
        assert.equal(await readFile(exported.path, 'utf8'), markdown);
        await writeFile(new URL('note_broken.json', directory), '{}');
        assert.equal((await call('search_practice_notes', {})).ok, false);
    } finally { await rm(root, { recursive: true, force: true }); }
});


test('Markdown 导出原样保留用户的章节、空白和代码围栏', async () => {
    const { practiceNoteToMarkdown } = await import('../src/storage/practice-notes.ts');
    const content = '  自由正文\n\n```python\nprint(1)\n```';
    assert.equal(practiceNoteToMarkdown({ title: '两数之和', problem: { number: 1 }, content }), '# 1. 两数之和\n\n' + content);
    assert.equal(practiceNoteToMarkdown({ title: '复习计划', content }), '# 复习计划\n\n' + content);
    assert.equal(practiceNoteToMarkdown({ title: '两数之和', problem: {}, content }), '# 两数之和\n\n' + content);
});
