import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePracticeNote } from '../../src/storage/practice-notes.ts';
import { toolDefinitions } from '../../src/tools/index.ts';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const suite = JSON.parse(await read('cases.json'));
const fixtures = JSON.parse(await read('fixtures.json'));
const notes = new Map();
for (const note of fixtures) {
    assert(!notes.has(note.id), `Duplicate fixture: ${note.id}`);
    notes.set(note.id, parsePracticeNote(note, note.id));
}
const toolNames = new Set(toolDefinitions.map(tool => tool.name));
const ids = new Set();
for (const item of suite.cases) {
    assert(!ids.has(item.id), `Duplicate case: ${item.id}`);
    ids.add(item.id);
    assert.match(item.inputFile, /^prompts\/[a-z0-9-]+\.md$/);
    const prompt = await read(item.inputFile);
    assert(prompt.trim().length > 0 && prompt.trim().length <= 10000);
    for (const id of item.initialNoteIds) assert(notes.has(id), `Unknown fixture: ${id}`);
    for (const name of item.requiredTools) assert(toolNames.has(name), `Unknown tool: ${name}`);
    assert(item.checks.length > 0 && item.forbidden.length > 0);
    for (const source of item.sources) {
        assert(source.line > 0 && source.heading && source.path);
        assert.match(source.sha256, /^[a-f0-9]{64}$/);
    }
    if (item.expected.originalCode) {
        assert(prompt.includes('```python\n' + item.expected.originalCode + '```'));
        assert(prompt.includes(item.expected.originalThought));
    }
    if (item.expected.targetId) {
        const before = notes.get(item.expected.targetId);
        assert(before);
        assert.deepEqual(item.expected.expectedTags, [...before.tags, '规范化表示']);
    }
}
assert.equal(ids.size, 8);
assert.equal(notes.size, 3);
console.log('用例格式有效：8 条提示、3 条初始笔记。未调用模型、联网或 Docker，未写入应用数据。');
