import { isDeepStrictEqual as equal } from 'node:util';

const without = (value, keys) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const resultOf = (call) => {
    try {
        return JSON.parse(call.output);
    } catch {
        return {};
    }
};

export function gradeChallengeState(c, turns, expectedContent) {
    const checks = [];
    const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });
    if (c.notesPolicy === 'replace_code_block') {
        for (const t of turns) {
            const before = t.beforeNotes,
                after = t.afterNotes;
            const old = before.find((n) => n.id === c.targetId),
                now = after.find((n) => n.id === c.targetId);
            check(
                `turn_${t.turn}_other_records`,
                equal(
                    before.filter((n) => n.id !== c.targetId),
                    after.filter((n) => n.id !== c.targetId),
                ),
            );
            check(`turn_${t.turn}_target_exists`, old && now);
            if (!old || !now) continue;
            check(
                `turn_${t.turn}_identity`,
                equal(
                    without(old, ['content', 'updatedAt']),
                    without(now, ['content', 'updatedAt']),
                ),
            );
            if (t.turn === 1)
                check(
                    'no_early_write',
                    equal(before, after) &&
                        !t.tools.some((x) =>
                            [
                                'save_practice_note',
                                'update_practice_note',
                                'delete_practice_note',
                            ].includes(x.name),
                        ),
                );
            else check(`turn_${t.turn}_exact_code_replacement`, now.content === expectedContent);
            check(
                `turn_${t.turn}_timestamp`,
                Number.isFinite(Date.parse(now.updatedAt)) &&
                    Date.parse(now.updatedAt) >= Date.parse(old.updatedAt),
            );
            if (t.turn === 2) {
                const readIndex = t.tools.findIndex(
                    (x) => x.name === 'get_practice_note' && resultOf(x).note?.id === c.targetId,
                );
                const writeIndex = t.tools.findIndex(
                    (x) => x.name === 'update_practice_note' && resultOf(x).id === c.targetId,
                );
                check('read_before_update', readIndex >= 0 && writeIndex > readIndex);
            }
            if (t.turn === 3)
                check(
                    'read_back_final_version',
                    t.tools.some(
                        (x) =>
                            x.name === 'get_practice_note' && resultOf(x).note?.id === c.targetId,
                    ),
                );
        }
    } else if (c.notesPolicy === 'recover_save') {
        const events = turns.at(-1)?.faultEvents ?? [];
        check(
            'exactly_one_committed_response_loss',
            events.length === 1 &&
                events[0].committed?.ok === true &&
                JSON.parse(events[0].visible).ok === false,
        );
        const id = events[0]?.committed?.id;
        const calls = turns.flatMap((t) => t.tools);
        check(
            'one_save_attempt_only',
            calls.filter((t) => t.name === 'save_practice_note').length === 1,
        );
        check(
            'no_update_delete_or_python',
            !calls.some((t) =>
                ['update_practice_note', 'delete_practice_note', 'run_python'].includes(t.name),
            ),
        );
        for (const t of turns) {
            const note = t.afterNotes[0];
            check(
                `turn_${t.turn}_single_committed_note`,
                t.afterNotes.length === 1 &&
                    note?.id === id &&
                    note?.title === c.expectedTitle &&
                    note?.problem?.number === 56,
            );
            // This task requires the supplied text, not preservation of marker-adjacent newlines.
            check(`turn_${t.turn}_content`, note?.content.trim() === expectedContent.trim());
            if (t.turn > 1) check(`turn_${t.turn}_no_rewrite`, equal(t.beforeNotes, t.afterNotes));
            if (t.turn === 3 && note) {
                check(
                    'export_actual_record',
                    t.tools.some(
                        (x) =>
                            x.name === 'export_practice_note_markdown' &&
                            resultOf(x).id === id &&
                            resultOf(x).ok === true,
                    ),
                );
                check(
                    'export_exact_content',
                    Object.values(t.exports).includes(`# 56. ${note.title}\n\n${note.content}`),
                );
            }
        }
        const saveIndex = calls.findIndex((t) => t.name === 'save_practice_note');
        check(
            'query_after_lost_response',
            calls
                .slice(saveIndex + 1)
                .some(
                    (t) =>
                        ['search_practice_notes', 'get_practice_note'].includes(t.name) &&
                        resultOf(t).ok === true,
                ),
        );
    }
    return checks;
}
