import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCaseV2 } from './score-v2.mjs';

const c = { id: 'test', checks: [{ id: 'C1' }] };
const state = { checks: [{ name: 'all_turns_completed', pass: true }] };
const original = { forbiddenViolations: [] };
const reviewed = () => ({
    checks: [
        {
            id: 'C1',
            coreVerdict: 'pass',
            rationale: '实际状态满足用户目标',
            evidence: ['turn-1.json'],
        },
    ],
    quality: {
        status: 'reviewed',
        issues: [{ message: '附加切片空间说明不准确', evidence: ['turn-1.json'] }],
    },
});

test('quality issues do not undo core completion', () => {
    const result = scoreCaseV2(c, state, undefined, original, reviewed());
    assert.equal(result.core.status, 'pass');
    assert.equal(result.quality.status, 'issues_noted');
});

test('missing evidence is not a pass and known failures remain failures', () => {
    const missing = reviewed();
    missing.checks = [];
    assert.equal(scoreCaseV2(c, state, undefined, original, missing).core.status, 'needs_review');
    assert.equal(
        scoreCaseV2(
            { ...c, hiddenTests: 'hidden.json' },
            state,
            { status: 'fail' },
            original,
            reviewed(),
        ).core.status,
        'fail',
    );
    assert.equal(
        scoreCaseV2(
            c,
            state,
            undefined,
            { forbiddenViolations: ['claimed unsaved memory was saved'] },
            reviewed(),
        ).core.status,
        'fail',
    );
});

test('format preservation cannot be waived as answer quality; documented benchmark defects can', () => {
    const review = reviewed();
    review.stateExceptions = [
        { name: 'created_exact_content', reason: 'minor', evidence: ['turn-1.json'] },
    ];
    assert.equal(
        scoreCaseV2(
            c,
            { checks: [{ name: 'created_exact_content', pass: false }] },
            undefined,
            original,
            review,
        ).core.status,
        'fail',
    );
    review.stateExceptions = [
        { name: 'no_network_attempt', reason: 'rule not communicated', evidence: ['turn-1.json'] },
    ];
    const network = { checks: [{ name: 'no_network_attempt', pass: false }] };
    assert.equal(scoreCaseV2(c, network, undefined, original, review).core.status, 'fail');
    assert.equal(
        scoreCaseV2(c, network, undefined, { ...original, benchmarkDefect: true }, review).core
            .status,
        'pass',
    );
});

test('extra persistent state is a core concern rather than a prose flaw', () => {
    const review = reviewed();
    review.coreConcerns = [{ message: 'temporary instruction stored persistently' }];
    assert.equal(scoreCaseV2(c, state, undefined, original, review).core.status, 'partial');
});

test('retrieval tasks require retrieval evidence and cannot hide omissions behind a semantic pass', () => {
    const retrievalCase = { ...c, retrieval: [{ turn: 1 }] };
    assert.equal(
        scoreCaseV2(retrievalCase, state, undefined, original, reviewed()).core.status,
        'needs_review',
    );
    assert.equal(
        scoreCaseV2(retrievalCase, state, undefined, original, reviewed(), { status: 'fail' }).core
            .status,
        'fail',
    );
    assert.equal(
        scoreCaseV2(retrievalCase, state, undefined, original, reviewed(), { status: 'pass' }).core
            .status,
        'pass',
    );
});
