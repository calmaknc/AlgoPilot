import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePracticeNoteInput, parsePracticeNote } from '../src/storage/practice-notes.ts';

function input() {
    return {
        problem: { title: ' 两数之和 ' },
        original: { thought: ' 我的思路\n', code: '    return answer\n' },
        summary: { approach: '', tags: [' 哈希表 '], timeComplexity: '', spaceComplexity: '', pitfalls: [], reviewPoints: [] },
    };
}

test('笔记输入：保留原文、可选字段、去除外部元数据和独立返回对象', () => {
    const value = input();
    value.id = 'external-id';
    value.createdAt = 'external-time';
    const parsed = parsePracticeNoteInput(value);
    assert.equal(parsed.problem.title, '两数之和');
    assert.equal(parsed.original.language, '');
    assert.equal(parsed.original.thought, value.original.thought);
    assert.equal(parsed.original.code, value.original.code);
    assert.deepEqual(parsed.summary.tags, ['哈希表']);
    assert.equal('number' in parsed.problem, false);
    assert.equal('url' in parsed.problem, false);
    assert.equal('id' in parsed, false);
    assert.equal('createdAt' in parsed, false);
    parsed.summary.tags.push('数组');
    assert.deepEqual(value.summary.tags, [' 哈希表 ']);
    const full = input();
    full.problem.number = 1;
    full.problem.url = 'https://leetcode.cn/problems/two-sum/';
    full.original.language = ' python ';
    full.original.solution = ' 题解原文\n';
    const result = parsePracticeNoteInput(full);
    assert.equal(result.problem.number, 1);
    assert.equal(result.problem.url, full.problem.url);
    assert.equal(result.original.language, 'python');
    assert.equal(result.original.solution, full.original.solution);
});

test('笔记输入：拒绝错误结构、类型和空白内容', () => {
    for (const value of [null, [], 42, {}, { problem: [] }]) assert.throws(() => parsePracticeNoteInput(value));
    const changes = [
        v => { v.problem.title = ' '; },
        ...[null, 0, -1, 1.5, '1', Infinity, Number.MAX_SAFE_INTEGER + 1].map(number => v => { v.problem.number = number; }),
        ...[null, 'not a url', 'javascript:alert(1)', 'file:///tmp/test'].map(url => v => { v.problem.url = url; }),
        v => { v.original.thought = ' '; v.original.code = '\n'; },
        v => { v.original.code = 123; },
        v => { v.original.language = null; },
        v => { v.original.solution = []; },
        v => { v.summary = null; },
        v => { v.summary.approach = 1; },
        v => { v.summary.timeComplexity = null; },
        v => { v.summary.spaceComplexity = []; },
        v => { v.summary.tags = '数组'; },
        v => { v.summary.pitfalls = ['']; },
        v => { v.summary.reviewPoints = [123]; },
    ];
    for (const change of changes) {
        const value = input();
        change(value);
        assert.throws(() => parsePracticeNoteInput(value));
    }
    const codeOnly = input();
    codeOnly.original.thought = '';
    assert.doesNotThrow(() => parsePracticeNoteInput(codeOnly));
    const thoughtOnly = input();
    thoughtOnly.original.code = '';
    assert.doesNotThrow(() => parsePracticeNoteInput(thoughtOnly));
});

test('笔记文件：校验 ID、时间顺序及正文，不补齐损坏的元数据', () => {
    const note = { ...input(), id: 'note-1', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T01:00:00.000Z' };
    assert.equal(parsePracticeNote(note, 'note-1').id, 'note-1');
    assert.throws(() => parsePracticeNote(note, '../escape'));
    assert.throws(() => parsePracticeNote(note, 'other'));
    assert.throws(() => parsePracticeNote(null, 'note-1'));
    for (const key of ['id', 'createdAt', 'updatedAt']) {
        const broken = { ...note };
        delete broken[key];
        assert.throws(() => parsePracticeNote(broken, 'note-1'));
    }
    assert.throws(() => parsePracticeNote({ ...note, createdAt: 'invalid' }, 'note-1'));
    assert.throws(() => parsePracticeNote({ ...note, updatedAt: 1 }, 'note-1'));
    assert.throws(() => parsePracticeNote({ ...note, updatedAt: '2026-10-21T00:00:00Z' }, 'note-1'));
    assert.throws(() => parsePracticeNote({ ...note, summary: {} }, 'note-1'));
    assert.doesNotThrow(() => parsePracticeNote({ ...note, updatedAt: note.createdAt }, 'note-1'));
});

test('笔记创建与读取：临时目录往返、缺失/损坏报错、写入失败不返回成功', async () => {
    const { mkdtemp, readFile, writeFile, readdir, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { createPracticeNote, getPracticeNote } = await import('../src/storage/practice-notes.ts');
    const temporary = await mkdtemp(join(tmpdir(), 'practice-notes-'));
    const directory = pathToFileURL(temporary + '/');
    try {
        const value = { ...input(), id: 'injected', createdAt: 'invalid' };
        const note = await createPracticeNote(value, directory);
        assert.notEqual(note.id, 'injected');
        assert.equal(note.createdAt, note.updatedAt);
        assert.ok(Number.isFinite(Date.parse(note.createdAt)));
        assert.deepEqual(await getPracticeNote(note.id, directory), note);
        const file = new URL(`note_${note.id}.json`, directory);
        assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), note);
        await assert.rejects(getPracticeNote('../escape', directory), /ID/);
        await assert.rejects(getPracticeNote('missing', directory), { code: 'ENOENT' });
        for (const corrupt of ['{', JSON.stringify({ ...note, id: 'wrong' }), JSON.stringify({ ...note, summary: {} })]) {
            await writeFile(file, corrupt, 'utf8');
            await assert.rejects(getPracticeNote(note.id, directory));
            assert.equal(await readFile(file, 'utf8'), corrupt);
        }
        const blocker = new URL('not-a-directory', directory);
        await writeFile(blocker, 'blocker');
        await assert.rejects(createPracticeNote(input(), new URL('not-a-directory/', directory)));
        assert.equal((await readdir(directory)).some(name => name.endsWith('.tmp')), false);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('笔记更新：保留身份和创建时间，非法更新不破坏已有文件', async () => {
    const { mkdtemp, rm, writeFile, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const { createPracticeNote, getPracticeNote, updatePracticeNote } = await import('../src/storage/practice-notes.ts');
    const temporary = await mkdtemp(join(tmpdir(), 'practice-update-'));
    const directory = pathToFileURL(temporary + '/');
    try {
        const old = await createPracticeNote(input(), directory);
        const replacement = input();
        replacement.summary.approach = '使用哈希表';
        replacement.summary.tags = ['数组', '哈希表'];
        const updated = await updatePracticeNote(old.id, { ...replacement, id: 'injected', createdAt: 'invalid' }, directory);
        assert.equal(updated.id, old.id);
        assert.equal(updated.createdAt, old.createdAt);
        assert.ok(Date.parse(updated.updatedAt) >= Date.parse(old.updatedAt));
        assert.equal(updated.summary.approach, '使用哈希表');
        assert.equal(updated.original.code, old.original.code);
        assert.deepEqual(await getPracticeNote(old.id, directory), updated);
        await assert.rejects(updatePracticeNote(old.id, {}, directory));
        assert.deepEqual(await getPracticeNote(old.id, directory), updated);
        await assert.rejects(updatePracticeNote('missing', replacement, directory), { code: 'ENOENT' });
        const file = new URL(`note_${old.id}.json`, directory);
        await writeFile(file, '{');
        await assert.rejects(updatePracticeNote(old.id, replacement, directory));
        assert.equal(await readFile(file, 'utf8'), '{');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
