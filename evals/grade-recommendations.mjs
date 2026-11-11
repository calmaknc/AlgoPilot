import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRunSuite } from './run-suite.mjs';

function officialUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['leetcode.com', 'leetcode.cn'].includes(url.hostname);
    } catch {
        return false;
    }
}

// A reviewer identifies recommendations and captures official metadata. The tested
// agent's claimed tags are never accepted as official evidence by themselves.
export function gradeRecommendation(spec, turn, review) {
    if (!turn || turn.error) return { status: 'fail', reason: 'No completed recommendation answer' };
    if (!review?.completeSelection || !Array.isArray(review.items)) {
        return { status: 'needs_review', reason: 'All positive recommendations must be annotated' };
    }
    if (!review.items.length) return { status: 'fail', reason: 'No recommendations' };
    const aliases = new Set(spec.aliases.map((tag) => tag.toLowerCase()));
    const items = review.items.map((item) => {
        if (
            !item.answerExcerpt || !turn.reply.includes(item.answerExcerpt) ||
            !officialUrl(item.sourceUrl) || !item.officialEvidence ||
            !item.identityVerified || !item.retrievedAt || !Array.isArray(item.tags)
        ) return { problem: item.problem, status: 'needs_review', reason: 'Missing verified official tag evidence or answer attribution' };
        return {
            problem: item.problem,
            status: item.tags.some((tag) => aliases.has(tag.toLowerCase())) ? 'pass' : 'fail',
            tags: item.tags,
            sourceUrl: item.sourceUrl,
        };
    });
    return {
        status: items.some((item) => item.status === 'fail') ? 'fail'
            : items.some((item) => item.status === 'needs_review') ? 'needs_review' : 'pass',
        items,
        notice: 'Only official tag membership determines recommendation suitability; no fixed IDs, rank, difficulty, rationale or number of items.',
    };
}

export async function gradeRecommendations(directory) {
    const read = async (name) => JSON.parse(await readFile(join(directory, name), 'utf8'));
    const manifest = await read('manifest.json');
    if (manifest.dryRun) throw Error('Cannot grade a dry run');
    const suite = await readRunSuite(directory);
    let annotations = { results: [] };
    try { annotations = await read('recommendation-review.json'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const results = [];
    for (const c of suite.cases.filter((c) => c.recommendation && manifest.selectedCaseIds.includes(c.id))) {
        let turn;
        try { turn = await read(`${c.id}-turn-${c.recommendation.turn}.json`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        results.push({ id: c.id, ...gradeRecommendation(c.recommendation, turn, annotations.results.find((r) => r.id === c.id)) });
    }
    await writeFile(join(directory, 'recommendation-grades.json'), JSON.stringify({ results }, null, 2) + '\n');
    return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (!process.argv[2]) throw Error('Usage: node grade-recommendations.mjs <run-directory>');
    console.log(await gradeRecommendations(process.argv[2]));
}
