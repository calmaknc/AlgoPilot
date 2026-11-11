import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentTools } from '../src/tools/index.ts';
import { searchPracticeNotes, getPracticeNote } from '../src/storage/practice-notes.ts';
import { createEvaluationTools } from './tool-adapter.mjs';
import { gradeChallengeState } from './challenge-state.mjs';

test('lost response occurs after SQLite commit and only once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hot100-fault-test-'));
    const notesDirectory = pathToFileURL(directory + '/');
    const events = [];
    try {
        const tools = createEvaluationTools(createAgentTools({ notesDirectory }), {
            fault: 'save_response_lost_after_commit_once',
            onFault: (event) => events.push(event),
        });
        const args = JSON.stringify({
            note: { title: '测试', content: '原文\n', problem: { number: 56 } },
        });
        const first = JSON.parse(await tools.executeTool('save_practice_note', args));
        assert.equal(first.ok, false);
        assert.equal(events.length, 1);
        const found = await searchPracticeNotes({}, notesDirectory);
        assert.equal(found.total, 1);
        assert.equal(found.matches[0].id, events[0].committed.id);
        assert.equal(
            (await getPracticeNote(found.matches[0].id, notesDirectory)).content,
            '原文\n',
        );
        const second = JSON.parse(await tools.executeTool('save_practice_note', args));
        assert.equal(second.ok, true);
        assert.equal(events.length, 1);
        assert.equal((await searchPracticeNotes({}, notesDirectory)).total, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('failed save does not consume the one committed-response fault', async () => {
    let count = 0;
    const events = [];
    const tools = createEvaluationTools(
        {
            executeTool: async () =>
                JSON.stringify(++count === 1 ? { ok: false } : { ok: true, id: 'real-id' }),
        },
        {
            fault: 'save_response_lost_after_commit_once',
            onFault: (event) => events.push(event),
        },
    );
    await tools.executeTool('save_practice_note', '{}');
    assert.equal(events.length, 0);
    assert.equal(JSON.parse(await tools.executeTool('save_practice_note', '{}')).ok, false);
    assert.equal(events[0].committed.id, 'real-id');
});

test('a duplicate save cannot be hidden by deleting the second record', () => {
    const c = { notesPolicy: 'recover_save', expectedTitle: '标题' };
    const note = { id: 'one', title: '标题', content: '正文', problem: { number: 56 } };
    const result = gradeChallengeState(
        c,
        [
            {
                turn: 1,
                beforeNotes: [],
                afterNotes: [note],
                faultEvents: [{ committed: { ok: true, id: 'one' }, visible: '{"ok":false}' }],
                tools: [
                    { name: 'save_practice_note', output: '{"ok":false}' },
                    { name: 'save_practice_note', output: '{"ok":true}' },
                    { name: 'delete_practice_note', output: '{"ok":true}' },
                ],
            },
        ],
        '正文',
    );
    assert.equal(result.find((x) => x.name === 'one_save_attempt_only').pass, false);
    assert.equal(result.find((x) => x.name === 'no_update_delete_or_python').pass, false);
});

test('evaluation permits search and page reads by default, preserving errors and signals', async () => {
    const calls = [];
    const controller = new AbortController();
    const original = {
        executeTool: async (...args) => {
            calls.push(args);
            return '{"ok":true,"source":"real-tool"}';
        },
    };
    const enabled = createEvaluationTools(original);
    for (const name of ['web_search', 'read_webpage']) {
        assert.equal(
            await enabled.executeTool(name, '{"query":"test"}', controller.signal),
            '{"ok":true,"source":"real-tool"}',
        );
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0][2], controller.signal);
    const legacy = createEvaluationTools(original, { network: 'disabled' });
    assert.equal(JSON.parse(await legacy.executeTool('web_search', '{}')).ok, false);
    assert.equal(calls.length, 2);
});
