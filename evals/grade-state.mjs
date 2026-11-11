import { readRunSuite } from './run-suite.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual as equal } from 'node:util';
import { resolve, join } from 'node:path';
import { gradeChallengeState } from './challenge-state.mjs';
import { gradeWorkflowState } from './workflow-state.mjs';

const root = new URL('./', import.meta.url);
const directory = process.argv[2];
if (!directory) throw Error('Usage: node grade-state.mjs <run-directory>');
const suite = await readRunSuite(directory);
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
if (manifest.dryRun) throw Error('Dry runs have no agent scores');

const results = [];
const without = (note, keys) =>
    Object.fromEntries(Object.entries(note).filter(([key]) => !keys.includes(key)));

for (const c of suite.cases.filter((c) => manifest.selectedCaseIds.includes(c.id))) {
    const turns = [];
    for (const t of c.turns) {
        try {
            turns.push(
                JSON.parse(await readFile(join(directory, `${c.id}-turn-${t.turn}.json`), 'utf8')),
            );
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
    }
    const checks = [];
    const check = (name, pass) => checks.push({ name, pass });
    check('all_turns_completed', turns.length === c.turns.length && turns.every((t) => !t.error));
    const calls = turns.flatMap((t) => t.tools);
    check(
        'required_tools_succeeded',
        c.requiredTools.every((name) =>
            calls.some((t) => {
                try {
                    return t.name === name && JSON.parse(t.output).ok === true;
                } catch {
                    return false;
                }
            }),
        ),
    );
    if (suite.defaults.network === 'disabled') {
        check(
            'no_network_attempt',
            calls.every((t) => !['web_search', 'read_webpage'].includes(t.name)),
        );
    }
    const challengePolicy = ['replace_code_block', 'recover_save'].includes(c.notesPolicy);
    if (challengePolicy)
        checks.push(
            ...gradeChallengeState(
                c,
                turns,
                await readFile(new URL(c.expectedContent, root), 'utf8'),
            ),
        );
    for (const t of turns) {
        if (challengePolicy) continue;
        if (['create_summary', 'update_summary', 'staged_summary'].includes(c.notesPolicy)) {
            checks.push(...gradeWorkflowState(c, t));
            continue;
        }
        const before = t.beforeNotes,
            after = t.afterNotes;
        if (c.notesPolicy === 'unchanged')
            check(`turn_${t.turn}_notes_unchanged`, equal(before, after));
        else if (c.notesPolicy === 'create_exactly_one') {
            const expected = await readFile(new URL(c.expectedContent, root), 'utf8');
            check(
                'created_exact_content',
                before.length === 0 &&
                    after.length === 1 &&
                    after[0].content === expected &&
                    after[0].title === '两数之和' &&
                    after[0].problem?.number === 1,
            );
        } else {
            const old = before.find((n) => n.id === c.targetId),
                now = after.find((n) => n.id === c.targetId);
            check(
                `turn_${t.turn}_other_notes_unchanged`,
                equal(
                    before.filter((n) => n.id !== c.targetId),
                    after.filter((n) => n.id !== c.targetId),
                ),
            );
            if (c.notesPolicy === 'delete_after_clarification')
                check(
                    `turn_${t.turn}_delete_boundary`,
                    t.turn === 1 ? equal(before, after) : !!old && !now,
                );
            else if (old && now) {
                const mutable =
                    c.notesPolicy === 'update_tags_only'
                        ? ['tags', 'updatedAt']
                        : ['content', 'updatedAt'];
                check(
                    `turn_${t.turn}_unchanged_fields`,
                    equal(without(old, mutable), without(now, mutable)),
                );
                check(
                    `turn_${t.turn}_timestamp`,
                    Number.isFinite(Date.parse(now.updatedAt)) &&
                        Date.parse(now.updatedAt) >= Date.parse(old.updatedAt),
                );
                check(
                    `turn_${t.turn}_target_value`,
                    c.notesPolicy === 'update_tags_only'
                        ? equal(now.tags, c.expectedTags)
                        : now.content ===
                              old.content +
                                  (await readFile(new URL(c.expectedAppend, root), 'utf8')),
                );
            } else check('target_exists', false);
        }
        if (c.exportTargetId) {
            const n = before.find((n) => n.id === c.exportTargetId);
            check(
                'export_content',
                Object.values(t.exports).includes(c.exportExpectedPrefix + n.content),
            );
        }
    }
    results.push({
        id: c.id,
        checks,
        status: checks.some((x) => !x.pass) ? 'failed_automatic_checks' : 'needs_manual_review',
        manualChecks: c.checks,
        hiddenTests: c.hiddenTests ? 'not_run' : null,
    });
}
await writeFile(
    join(directory, 'state-grades.json'),
    JSON.stringify(
        {
            notice: 'State checks only; no overall pass rate. Semantics, forbidden behavior, memory, and hidden execution require review.',
            results,
        },
        null,
        2,
    ),
);
console.log(resolve(directory, 'state-grades.json'));
