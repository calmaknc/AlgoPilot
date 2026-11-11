import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRunSuite } from './run-suite.mjs';

// Selection roles are annotated from the answer, not inferred from every mentioned ID.
export function gradeRetrievalTurn(spec, turn, annotation, corpusIds) {
    if (turn?.error) {
        return {
            turn: spec.turn,
            status: 'fail',
            reason: 'Execution failed; no completed answer',
            precision: null,
            recall: null,
        };
    }
    if (
        !turn ||
        !annotation ||
        !Array.isArray(annotation.selectedIds) ||
        !annotation.evidence ||
        !annotation.rationale
    ) {
        return {
            turn: spec.turn,
            status: 'needs_review',
            reason: 'Missing completed answer or selection-role review',
        };
    }
    const selected = [...new Set(annotation.selectedIds)];
    if (selected.some((id) => typeof id !== 'string' || !turn.reply.includes(id))) {
        return {
            turn: spec.turn,
            status: 'needs_review',
            reason: 'Selection annotation must cite actual IDs in the answer',
        };
    }
    const accepted = new Set([...spec.requiredIds, ...spec.optionalIds]);
    const missing = spec.requiredIds.filter((id) => !selected.includes(id));
    const extra = selected.filter((id) => !accepted.has(id));
    const unknown = selected.filter((id) => !corpusIds.includes(id));
    const reads = new Set();
    let successfulSearches = 0;
    for (const call of turn.tools) {
        let output;
        try {
            output = JSON.parse(call.output);
        } catch {
            continue;
        }
        if (!output.ok) continue;
        if (call.name === 'get_practice_note' && output.note?.id) reads.add(output.note.id);
        if (call.name === 'search_practice_notes') successfulSearches++;
    }
    const unread = spec.requireFullRead ? selected.filter((id) => !reads.has(id)) : [];
    const correct = selected.filter((id) => accepted.has(id)).length;
    const rankCorrect = !spec.rankFirst || selected[0] === spec.rankFirst;
    return {
        turn: spec.turn,
        status:
            missing.length ||
            extra.length ||
            unknown.length ||
            unread.length ||
            !rankCorrect ||
            (spec.negativeSearchRequired && !successfulSearches)
                ? 'fail'
                : 'pass',
        selectedIds: selected,
        missingIds: missing,
        extraIds: extra,
        unknownIds: unknown,
        notReadInContext: unread,
        rankCorrect,
        successfulSearches,
        precision: selected.length ? correct / selected.length : null,
        recall: spec.requiredIds.length
            ? (spec.requiredIds.length - missing.length) / spec.requiredIds.length
            : null,
        negativeResult: spec.requiredIds.length === 0 ? selected.length === 0 : null,
        notice: 'Precision/recall use reviewed positive selections only; explanations and personal-history claims still need semantic review.',
    };
}

export async function gradeRetrievalRun(directory) {
    const suite = await readRunSuite(directory);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.dryRun) throw Error('Cannot grade a dry run');
    let annotations = { results: [] };
    try {
        annotations = JSON.parse(await readFile(join(directory, 'retrieval-review.json'), 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const results = [];
    for (const c of suite.cases.filter(
        (c) => c.retrieval && manifest.selectedCaseIds.includes(c.id),
    )) {
        const turns = [];
        const priorTools = [];
        for (const spec of c.retrieval) {
            let turn;
            try {
                turn = JSON.parse(
                    await readFile(join(directory, `${c.id}-turn-${spec.turn}.json`), 'utf8'),
                );
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            const annotation = annotations.results
                .find((item) => item.id === c.id)
                ?.turns?.find((t) => t.turn === spec.turn);
            const evidenceTurn = turn && {
                ...turn,
                tools: spec.requireReadThisTurn ? turn.tools : [...priorTools, ...turn.tools],
            };
            turns.push(gradeRetrievalTurn(spec, evidenceTurn, annotation, c.initialNoteIds));
            if (turn) priorTools.push(...turn.tools);
        }
        results.push({
            id: c.id,
            status: turns.some((t) => t.status === 'fail')
                ? 'fail'
                : turns.some((t) => t.status === 'needs_review')
                  ? 'needs_review'
                  : 'pass',
            turns,
        });
    }
    const report = {
        results,
        reviewerRequired:
            'Positive selection roles need evidence annotation; missing review never counts as a pass.',
    };
    await writeFile(
        join(directory, 'retrieval-grades.json'),
        JSON.stringify(report, null, 2) + '\n',
    );
    return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (!process.argv[2]) throw Error('Usage: node grade-retrieval.mjs <run-directory>');
    console.log(JSON.stringify(await gradeRetrievalRun(process.argv[2])));
}
