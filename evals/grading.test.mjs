import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSolutions, compareObservation } from './grading-utils.mjs';

test('text fences must not swallow a later Python solution', () => {
    const text =
        '```text\nexample\n```\n\n```python\nclass Solution:\n    def rotate(self, matrix): pass\n```';
    assert.equal(extractSolutions(text, 'rotate').length, 1);
    assert.equal(extractSolutions(text + '\n' + text, 'rotate').length, 2);
});

test('triplet order is irrelevant, duplicates are not', () => {
    assert.equal(compareObservation(15, { valid: true, value: [[1, 0, -1]] }, [[-1, 0, 1]]), true);
    assert.equal(
        compareObservation(
            15,
            {
                valid: true,
                value: [
                    [-1, 0, 1],
                    [1, 0, -1],
                ],
            },
            [[-1, 0, 1]],
        ),
        false,
    );
    assert.equal(compareObservation(15, { valid: true, value: [[0, 0]] }, []), false);
});

test('correct values cannot mask a cycle, new nodes, or wrong return contract', () => {
    for (const n of [206, 48, 283])
        assert.equal(compareObservation(n, { valid: false, value: [1] }, [1]), false);
    assert.equal(compareObservation(3, { error: 'IndexError' }, 1), false);
    assert.equal(compareObservation(3, { valid: true, value: 1 }, 1), true);
});
