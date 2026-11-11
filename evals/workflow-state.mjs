import { isDeepStrictEqual as equal } from 'node:util';

// Content completeness is reviewed semantically; do not require a particular layout.
export function gradeWorkflowState(c, t) {
    const before = t.beforeNotes;
    const after = t.afterNotes;
    const name = (suffix) => `turn_${t.turn}_${suffix}`;
    if (c.notesPolicy === 'update_summary') {
        const old = before.find((n) => n.id === c.targetId);
        const now = after.find((n) => n.id === c.targetId);
        const immutable = (n) => Object.fromEntries(
            Object.entries(n).filter(([key]) => !['content', 'updatedAt'].includes(key)),
        );
        return [
            { name: name('target_preserved'), pass: !!old && !!now && equal(immutable(old), immutable(now)) },
            { name: name('other_notes_unchanged'), pass: equal(before.filter((n) => n.id !== c.targetId), after.filter((n) => n.id !== c.targetId)) },
            { name: name('content_updated'), pass: !!old && !!now && old.content !== now.content },
        ];
    }
    if (c.notesPolicy === 'staged_summary' && t.turn !== c.summaryTurn) {
        return [{ name: name('notes_unchanged'), pass: equal(before, after) }];
    }
    const added = after.filter((n) => !before.some((old) => old.id === n.id));
    return [
        { name: name('existing_notes_preserved'), pass: equal(before, after.filter((n) => before.some((old) => old.id === n.id))) },
        // These are semantic organization tasks, not exact-title preservation tasks.
        // The reviewer checks the title's subject along with the requested content;
        // adding a problem number or description is not a failed write.
        { name: name('one_summary_created'), pass: added.length === 1 && added[0].problem?.number === c.summaryProblem && !!added[0].title?.trim() && !!added[0].content?.trim() },
    ];
}
