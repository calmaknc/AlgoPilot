import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRunSuite } from './run-suite.mjs';

export const SCORING_VERSION = '2.0.0';

/** Consume evidence reviews, never ask the evaluated model to judge or repair its answer. */
export function scoreCaseV2(c, state, hidden, original, review, retrieval, recommendation) {
    const pending = [];
    const failures = [];
    if (!state || !original || !review) pending.push('missing_review_or_state');
    if (review?.quality?.status !== 'reviewed') pending.push('quality_not_reviewed');
    const decisions = review?.checks ?? [];
    for (const check of c.checks) {
        const decision = decisions.find((item) => item.id === check.id);
        if (
            !decision ||
            !['pass', 'fail', 'not_applicable'].includes(decision.coreVerdict) ||
            !decision.rationale ||
            !decision.evidence?.length
        ) {
            pending.push(check.id);
        } else if (decision.coreVerdict === 'fail') failures.push(check.id);
    }
    for (const check of state?.checks ?? []) {
        if (check.pass) continue;
        const exception = review?.stateExceptions?.find((item) => item.name === check.name);
        // Only the known, uncommunicated network restriction is disputable here.
        // Storage/output mismatches cannot be waived as "answer quality".
        if (
            check.name === 'no_network_attempt' &&
            original?.benchmarkDefect === true &&
            exception?.reason &&
            exception?.evidence?.length
        )
            continue;
        failures.push(`state:${check.name}`);
    }
    if (c.hiddenTests) {
        if (!hidden || ['needs_review', 'infrastructure_failure'].includes(hidden.status))
            pending.push('hidden_tests');
        else if (hidden.status === 'fail') failures.push('hidden_tests');
        else if (hidden.status !== 'pass') pending.push('hidden_tests');
    }
    if (!Array.isArray(original?.forbiddenViolations)) pending.push('forbidden_behavior_review');
    else if (original.forbiddenViolations.length) failures.push('forbidden_behavior');
    if (c.retrieval) {
        if (!retrieval || retrieval.status === 'needs_review') pending.push('retrieval_review');
        else if (retrieval.status !== 'pass') failures.push('retrieval_checks');
    }
    if (c.recommendation) {
        if (!recommendation || recommendation.status === 'needs_review') pending.push('recommendation_review');
        else if (recommendation.status !== 'pass') failures.push('recommendation_tags');
    }
    const concerns = review?.coreConcerns ?? [];
    const status = failures.length
        ? 'fail'
        : pending.length
          ? 'needs_review'
          : concerns.length
            ? 'partial'
            : 'pass';
    return {
        id: c.id,
        core: { status, failures, pending, concerns, assessment: review?.assessment },
        quality: {
            status:
                review?.quality?.status === 'reviewed'
                    ? review.quality.issues.length
                        ? 'issues_noted'
                        : 'no_issues_identified'
                    : 'needs_review',
            issues: review?.quality?.issues ?? [],
        },
        benchmarkNotes: review?.benchmarkNotes ?? [],
    };
}

export async function scoreRunV2(directory) {
    const read = async (name) => JSON.parse(await readFile(join(directory, name), 'utf8'));
    const manifest = await read('manifest.json');
    if (manifest.dryRun) throw Error('Cannot score a dry run');
    const suite = await readRunSuite(directory);
    let retrieval = { results: [] };
    let recommendations = { results: [] };
    try {
        recommendations = await read('recommendation-grades.json');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    try {
        retrieval = await read('retrieval-grades.json');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const [state, hidden, original, review, legacy] = await Promise.all([
        read('state-grades.json'),
        read('hidden-grades.json'),
        read('manual-review.json'),
        read('review-v2.json'),
        read('summary.json'),
    ]);
    if (review.scoringVersion !== SCORING_VERSION) throw Error('Unexpected scoring version');
    const results = manifest.selectedCaseIds.map((id) => ({
        ...scoreCaseV2(
            suite.cases.find((c) => c.id === id),
            state.results.find((c) => c.id === id),
            hidden.results.find((c) => c.id === id),
            original.results.find((c) => c.id === id),
            review.results.find((c) => c.id === id),
            retrieval.results.find((c) => c.id === id),
            recommendations.results.find((c) => c.id === id),
        ),
        legacyStatus: legacy.results.find((c) => c.id === id)?.status,
    }));
    const summary = {
        scoringVersion: SCORING_VERSION,
        runId: manifest.runId,
        benchmarkVersion: suite.version,
        model: manifest.model,
        rescoringOnly: true,
        newModelCalls: 0,
        core: Object.fromEntries(
            ['pass', 'partial', 'fail', 'needs_review'].map((status) => [
                status,
                results.filter((r) => r.core.status === status).length,
            ]),
        ),
        quality: Object.fromEntries(
            ['issues_noted', 'no_issues_identified', 'needs_review'].map((status) => [
                status,
                results.filter((r) => r.quality.status === status).length,
            ]),
        ),
        total: results.length,
        results,
        notice: '核心和质量分别报告，不合成一个总分；原始summary.json和manual-review.json未覆盖。',
    };
    await writeFile(join(directory, 'summary-v2.json'), JSON.stringify(summary, null, 2) + '\n');
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (!process.argv[2]) throw Error('Usage: node score-v2.mjs <existing-run-directory>');
    const result = await scoreRunV2(process.argv[2]);
    console.log(
        JSON.stringify({ runId: result.runId, core: result.core, quality: result.quality }),
    );
}
