import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePracticeNoteInput, parsePracticeNote, createPracticeNote, getPracticeNote, updatePracticeNote, searchPracticeNotes } from '../src/storage/practice-notes.ts';
const input = () => ({ title: ' 我的疑问 ', content: '  为什么这里用 <=？\n\n```python\n    return a\n```\n', tags: [' 二分 '] });

test('自由正文不要求题目或模板，保留空白和代码，元数据独立', () => {
    const value = input();
    const parsed = parsePracticeNoteInput({ ...value, id: 'external' });
    assert.equal(parsed.content, value.content);
    assert.equal(parsed.title, '我的疑问');
    assert.deepEqual(parsed.tags, ['二分']);
    assert.equal(parsed.problem, undefined);
    assert.equal(parsed.id, undefined);
    parsed.tags.push('其他');
    assert.deepEqual(value.tags, [' 二分 ']);
    assert.deepEqual(parsePracticeNoteInput({ title: '计划', content: '明天复习' }).tags, []);
});

test('校验正文大小、字段类型和可选题目链接，拒绝旧格式', () => {
    for (const patch of [{title:''}, {title:'a\nb'}, {content:' '}, {content:42}, {content:'中'.repeat(12000)}, {tags:[1]}, {tags:null}, {problem:null}, {problem:{number:0}}, {problem:{url:'file:///tmp/a'}}]) {
        assert.throws(() => parsePracticeNoteInput({...input(), ...patch}));
    }
    assert.throws(() => parsePracticeNoteInput({problem:{title:'旧'},original:{thought:'旧'},summary:{}}));
    const note = {...input(), schemaVersion:2, id:'one', createdAt:'2026-10-22T00:00:00Z', updatedAt:'2026-10-22T00:00:00Z'};
    assert.equal(parsePracticeNote(note,'one').id,'one');
    for (const patch of [{schemaVersion:1}, {id:'other'}, {createdAt:'bad'}, {updatedAt:'2025-01-01'}]) assert.throws(()=>parsePracticeNote({...note,...patch},'one'));
    assert.throws(()=>parsePracticeNote(note,'../escape'));
});

test('持久化、局部更新、原样追加、清除关联与失败保护', async () => {
    const root = await mkdtemp(join(tmpdir(),'free-notes-'));
    const directory = pathToFileURL(root+'/');
    try {
        const saved = await createPracticeNote({...input(),problem:{number:1,url:'https://example.com'}},directory);
        assert.deepEqual(await getPracticeNote(saved.id,directory),saved);
        const renamed = await updatePracticeNote(saved.id,{title:'新标题'},directory);
        assert.equal(renamed.content,saved.content);
        assert.deepEqual(renamed.tags,saved.tags);
        const appended = await updatePracticeNote(saved.id,{appendContent:'\n新的反例',problem:null,tags:[]},directory);
        assert.equal(appended.content,saved.content+'\n新的反例');
        assert.equal(appended.problem,undefined);
        assert.deepEqual(appended.tags,[]);
        assert.equal(appended.createdAt,saved.createdAt);
        assert.equal((await searchPracticeNotes({query:'新的反例'},directory)).total,1);
        assert.equal((await searchPracticeNotes({number:1},directory)).total,0);
        for (const patch of [{}, {content:'x',appendContent:'y'}, {appendContent:' '}, {appendContent:'x'.repeat(32768)}, {id:'other'}, {title:undefined}]) await assert.rejects(updatePracticeNote(saved.id,patch,directory));
        assert.deepEqual(await getPracticeNote(saved.id,directory),appended);
        await assert.rejects(getPracticeNote('../escape',directory));
        await assert.rejects(updatePracticeNote('missing',{title:'x'},directory));
        assert.deepEqual(await readdir(root), ['notes.sqlite']);
        assert.equal((await readFile(new URL('notes.sqlite', directory))).subarray(0, 16).toString(), 'SQLite format 3\0');
        const db = new DatabaseSync(join(root, 'notes.sqlite'));
        try {
            db.prepare('UPDATE notes SET tags = ? WHERE id = ?').run('{', saved.id);
            await assert.rejects(updatePracticeNote(saved.id,{content:'x'},directory));
            assert.equal(db.prepare('SELECT content FROM notes WHERE id = ?').get(saved.id).content, appended.content);
            db.prepare('UPDATE notes SET tags = ? WHERE id = ?').run('[]', saved.id);
        } finally { db.close(); }
        await Promise.all([' A', ' B', ' C'].map(appendContent => updatePracticeNote(saved.id, {appendContent}, directory)));
        const concurrent = await getPracticeNote(saved.id, directory);
        for (const addition of [' A', ' B', ' C']) assert.ok(concurrent.content.includes(addition));
        const blocker = new URL('blocker',directory);
        await writeFile(blocker,'x');
        await assert.rejects(createPracticeNote(input(),new URL('blocker/',directory)));
    } finally { await rm(root,{recursive:true,force:true}); }
});


test('SQLite 保留特殊字符、Unicode 搜索与空题目关联，不读取旧 JSON', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sql-notes-'));
    const directory = pathToFileURL(root + '/');
    try {
        await writeFile(new URL('note_legacy.json', directory), '{}');
        assert.equal((await searchPracticeNotes({}, directory)).total, 0);
        const note = await createPracticeNote({title: "SQL ' %_", content: "  ÉCOLE\n中文\n'); DROP TABLE notes; --\n", tags: ['ÉTÉ'], problem: {}}, directory);
        assert.deepEqual(await getPracticeNote(note.id, directory), note);
        assert.equal((await searchPracticeNotes({query:'école', tag:'été'}, directory)).total, 1);
        assert.equal((await searchPracticeNotes({query:'%_'}, directory)).total, 1);
        assert.equal((await searchPracticeNotes({query:'absent'}, directory)).total, 0);
        const second = await createPracticeNote({title:'第二条', content:'正文'}, directory);
        const result = await searchPracticeNotes({limit:1}, directory);
        assert.equal(result.total, 2);
        assert.equal(result.matches.length, 1);
        const expected = [note, second].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        assert.equal(result.matches[0].id, expected[0].id);
        const controller = new AbortController(); controller.abort();
        await assert.rejects(searchPracticeNotes({}, directory, controller.signal), {name:'AbortError'});
    } finally { await rm(root, {recursive:true, force:true}); }
});
