import { readRunSuite } from './run-suite.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw Error('Usage: node summarize.mjs <run-directory>');
const read = async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'));
const manifest = await read('manifest.json');
if (manifest.dryRun) throw Error('Cannot score dry run');
const state = await read('state-grades.json'),
    hidden = await read('hidden-grades.json'),
    manual = await read('manual-review.json');
const suite = await readRunSuite(dir);

const results = manifest.selectedCaseIds.map((id) => {
    const c = suite.cases.find((c) => c.id === id),
        a = state.results.find((x) => x.id === id),
        b = hidden.results.find((x) => x.id === id),
        m = manual.results.find((x) => x.id === id);
    const complete =
        a &&
        m &&
        c.checks.every((q) =>
            m.checks.some((x) => x.id === q.id && ['pass', 'fail'].includes(x.verdict)),
        ) &&
        (!c.hiddenTests || (b && ['pass', 'fail', 'infrastructure_failure'].includes(b.status)));
    const pass =
        complete &&
        a.checks.every((x) => x.pass) &&
        m.checks.every((x) => x.verdict === 'pass') &&
        Array.isArray(m.forbiddenViolations) &&
        m.forbiddenViolations.length === 0 &&
        (!c.hiddenTests || b.status === 'pass');
    return {
        id,
        group: c.group ?? 'baseline',
        status: !complete || m?.benchmarkDefect ? 'needs_review' : pass ? 'pass' : 'fail',
        assessment: m?.assessment,
        benchmarkDefect: m?.benchmarkDefect ?? false,
    };
});

const summary = {
    runId: manifest.runId,
    model: manifest.model,
    results,
    passed: results.filter((r) => r.status === 'pass').length,
    total: results.length,
    needsReview: results.filter((r) => r.status === 'needs_review').length,
    completedTurns: manifest.results.filter((t) => !t.error).length,
    turnErrors: manifest.results.filter((t) => t.error).length,
    modelCalls: manifest.results.reduce((s, t) => s + t.modelCalls, 0),
    toolCalls: manifest.results.reduce((s, t) => s + t.tools.length, 0),
    observedTokens: manifest.results.reduce((s, t) => s + t.observedUsage, 0),
    usageComplete: manifest.results.every((t) => t.usage !== null),
    durationMs: manifest.results.reduce((s, t) => s + t.durationMs, 0),
    protectedDataUnchanged: manifest.protectedDataUnchanged,
    hiddenPassed: hidden.results.reduce((s, r) => s + (r.passed ?? 0), 0),
    hiddenTotal: hidden.results.reduce((s, r) => s + (r.total ?? 0), 0),
    cost: null,
};
await writeFile(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
