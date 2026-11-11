import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeWorkflowState } from './workflow-state.mjs';
import { gradeRecommendation } from './grade-recommendations.mjs';
import { scoreCaseV2 } from './score-v2.mjs';

const note = { id: 'old', title: '旧笔记', content: '原文', tags: [], problem: { number: 53 } };
test('staged learning only writes on the requested final turn', () => {
    const c = { notesPolicy: 'staged_summary', summaryTurn: 5, summaryProblem: 42, summaryTitle: '接雨水' };
    const added = { ...note, id: 'new', title: '接雨水', problem: { number: 42 } };
    assert(gradeWorkflowState(c, { turn: 4, beforeNotes: [], afterNotes: [] }).every((c) => c.pass));
    assert(gradeWorkflowState(c, { turn: 4, beforeNotes: [], afterNotes: [added] }).some((c) => !c.pass));
    assert(gradeWorkflowState(c, { turn: 5, beforeNotes: [note], afterNotes: [note, added] }).every((c) => c.pass));
    assert(gradeWorkflowState(c, { turn: 5, beforeNotes: [], afterNotes: [{ ...added, title: '接雨水（题号42）' }] }).every((c) => c.pass));
    assert(gradeWorkflowState(c, { turn: 5, beforeNotes: [], afterNotes: [{ ...added, problem: { number: 1 } }] }).some((c) => !c.pass));
    assert(gradeWorkflowState(c, { turn: 5, beforeNotes: [note], afterNotes: [added] }).some((c) => !c.pass));
});
test('semantic update permits layout changes but preserves identity and unrelated records', () => {
    const c = { notesPolicy: 'update_summary', targetId: 'old' };
    assert(gradeWorkflowState(c, { turn: 1, beforeNotes: [note], afterNotes: [{ ...note, content: '新排版与原文' }] }).every((c) => c.pass));
    assert(gradeWorkflowState(c, { turn: 1, beforeNotes: [note], afterNotes: [{ ...note, content: '新', tags: ['擅自修改'] }] }).some((c) => !c.pass));
});
const spec = { aliases: ['Dynamic Programming', '动态规划', 'dynamic-programming'] };
const turn = { reply: '推荐甲题和乙题', tools: [] };
const item = { problem: '甲', answerExcerpt: '甲题', tags: ['动态规划'], sourceUrl: 'https://leetcode.cn/problems/example/', officialEvidence: 'captured topicTags metadata', identityVerified: true, retrievedAt: '2026-11-11' };
test('any official matching tag passes; no fixed problem IDs, recommendation count or rationale', () => {
    assert.equal(gradeRecommendation(spec, turn, { completeSelection: true, items: [item] }).status, 'pass');
    assert.equal(gradeRecommendation(spec, turn, { completeSelection: true, items: [{ ...item, tags: ['Array'] }] }).status, 'fail');
    assert.equal(gradeRecommendation(spec, turn, { completeSelection: true, items: [item, { ...item, problem: '乙', answerExcerpt: '乙题', tags: ['Array'] }] }).status, 'fail');
});
test('missing or unofficial tag evidence cannot silently pass', () => {
    assert.equal(gradeRecommendation(spec, turn).status, 'needs_review');
    assert.equal(gradeRecommendation(spec, turn, { completeSelection: true, items: [{ ...item, sourceUrl: 'https://example.com/' }] }).status, 'needs_review');
    assert.equal(gradeRecommendation(spec, { error: 'timeout' }).status, 'fail');
});
test('overall scorer requires recommendation grading only for the recommendation task', () => {
    const c = { id: 'x', checks: [], recommendation: spec };
    const args = [c, { checks: [] }, null, { forbiddenViolations: [] }, { quality: { status: 'reviewed', issues: [] } }, undefined];
    assert.equal(scoreCaseV2(...args).core.status, 'needs_review');
    assert.equal(scoreCaseV2(...args, { status: 'pass' }).core.status, 'pass');
    assert.equal(scoreCaseV2(...args, { status: 'fail' }).core.status, 'fail');
});
