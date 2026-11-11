import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeRetrievalTurn } from './grade-retrieval.mjs';
const spec = { turn: 1, requiredIds: ['a', 'b'], optionalIds: [], requireFullRead: true };
const turn = {
    reply: 'a b c',
    tools: ['a', 'b', 'c'].map((id) => ({
        name: 'get_practice_note',
        output: JSON.stringify({ ok: true, note: { id } }),
    })),
};
const review = (ids) => ({
    selectedIds: ids,
    evidence: 'answer table',
    rationale: 'reviewed primary recommendations',
});
test('comparison mentions do not become false positives; omissions and wrong recommendations remain visible', () => {
    assert.equal(
        gradeRetrievalTurn(spec, turn, review(['a', 'b']), ['a', 'b', 'c']).status,
        'pass',
    );
    const bad = gradeRetrievalTurn(spec, turn, review(['a', 'c']), ['a', 'b', 'c']);
    assert.deepEqual(bad.missingIds, ['b']);
    assert.deepEqual(bad.extraIds, ['c']);
    assert.equal(bad.precision, 0.5);
    assert.equal(bad.recall, 0.5);
});
test('unread citation, fabricated ID, and missing human annotation cannot pass', () => {
    assert.equal(
        gradeRetrievalTurn(spec, { ...turn, tools: [] }, review(['a', 'b']), ['a', 'b']).status,
        'fail',
    );
    assert.equal(gradeRetrievalTurn(spec, turn, review(['a', 'c']), ['a', 'b']).unknownIds[0], 'c');
    assert.equal(gradeRetrievalTurn(spec, turn, null, ['a', 'b']).status, 'needs_review');
});
test('negative results need successful search, not an empty recommendation alone', () => {
    const negative = { ...spec, requiredIds: [], negativeSearchRequired: true };
    assert.equal(gradeRetrievalTurn(negative, turn, review([]), ['a']).status, 'fail');
    const searched = {
        ...turn,
        tools: [{ name: 'search_practice_notes', output: '{"ok":true,"matches":[]}' }],
    };
    assert.equal(gradeRetrievalTurn(negative, searched, review([]), ['a']).status, 'pass');
});

test('an execution error is a known task failure, not zero precision or a missing review', () => {
    const result = gradeRetrievalTurn(spec, { ...turn, error: { message: 'failed' } }, null, [
        'a',
        'b',
    ]);
    assert.equal(result.status, 'fail');
    assert.equal(result.precision, null);
    assert.equal(result.recall, null);
});
