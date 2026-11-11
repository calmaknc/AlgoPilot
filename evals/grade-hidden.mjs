import { readRunSuite } from './run-suite.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractSolutions, compareObservation } from './grading-utils.mjs';
import { runPythonSandbox } from '../src/sandbox/runner.ts';

const base = new URL('./', import.meta.url),
    directory = process.argv[2];
if (!directory) throw Error('Usage: node grade-hidden.mjs <run-directory>');
const suite = await readRunSuite(directory);
const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
if (manifest.dryRun) throw Error('Cannot grade dry run');

const results = [];

for (const c of suite.cases.filter(
    (c) => c.hiddenTests && manifest.selectedCaseIds.includes(c.id),
)) {
    const tests = JSON.parse(await readFile(new URL(c.hiddenTests, base), 'utf8'));
    let task;
    try {
        task = JSON.parse(
            await readFile(join(directory, `${c.id}-turn-${c.hiddenTurn ?? 1}.json`), 'utf8'),
        );
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        results.push({
            id: c.id,
            status: 'fail',
            passed: 0,
            total: tests.tests.length,
            reason: 'Required final turn did not run',
        });
        continue;
    }
    const method = {
        283: 'moveZeroes',
        15: 'threeSum',
        3: 'lengthOfLongestSubstring',
        206: 'reverseList',
        48: 'rotate',
        54: 'spiralOrder',
        23: 'mergeKLists',
        42: 'trap',
        2747: 'countServers',
    }[tests.problemNumber];
    const text = tests.problemNumber === 283 ? task.prompt : task.reply;
    const blocks = extractSolutions(text, method);
    if (blocks.length !== 1) {
        results.push({
            id: c.id,
            status: 'needs_review',
            reason: `Expected one full solution, found ${blocks.length}`,
        });
        continue;
    }
    const candidate = blocks[0];
    await writeFile(join(directory, `${c.id}.candidate.py`), candidate);
    const wrapper = `import json, sys, typing, copy
from typing import *
class ListNode:
    def __init__(self, val=0, next=None):
        self.val, self.next = val, next
ns = {'ListNode': ListNode, 'List': List, 'Optional': Optional}
exec(${JSON.stringify(candidate)}, ns)
results=[]
for value in json.load(sys.stdin):
    try:
        if ${tests.problemNumber} == 206:
            nodes=[ListNode(v) for v in value]
            for a,b in zip(nodes,nodes[1:]): a.next=b
            out=ns['Solution']().reverseList(nodes[0] if nodes else None)
            seen=[]; vals=[]
            while out is not None and id(out) not in seen and len(seen)<=len(nodes):
                seen.append(id(out)); vals.append(out.val); out=out.next
            results.append({'value':vals,'valid':out is None and seen==[id(n) for n in nodes][::-1]})
        elif ${tests.problemNumber} == 23:
            all_nodes = []
            heads = []
            for values in value:
                nodes = [ListNode(v) for v in values]
                all_nodes.extend(nodes)
                for a, b in zip(nodes, nodes[1:]):
                    a.next = b
                heads.append(nodes[0] if nodes else None)
            out = ns['Solution']().mergeKLists(heads)
            seen, vals = [], []
            while out is not None and id(out) not in seen and len(seen) <= len(all_nodes):
                seen.append(id(out))
                vals.append(out.val)
                out = out.next
            results.append({'value': vals, 'valid': out is None and len(seen) == len(all_nodes) and set(seen) == {id(n) for n in all_nodes}})
        elif ${tests.problemNumber} == 2747:
            out = ns['Solution']().countServers(*copy.deepcopy(value))
            results.append({'value': out, 'valid': True})
        elif ${tests.problemNumber} == 54:
            before = copy.deepcopy(value)
            out = ns['Solution']().spiralOrder(value)
            results.append({'value': out, 'valid': value == before})
        else:
            out=getattr(ns['Solution'](), ${JSON.stringify(method)})(value)
            results.append({'value':value if ${tests.problemNumber} in [283,48] else out, 'valid':out is None if ${tests.problemNumber} in [283,48] else True})
    except Exception as e:
        results.append({'error':type(e).__name__+': '+str(e)})
print('HOT100_RESULTS='+json.dumps(results))
`;
    const execution = await runPythonSandbox({
        code: wrapper,
        stdin: JSON.stringify(tests.tests.map((t) => t.input)),
    });
    let observations;
    try {
        observations = JSON.parse(
            execution.stdout
                .split('\n')
                .findLast((l) => l.startsWith('HOT100_RESULTS='))
                ?.slice(15),
        );
    } catch {}
    const checks = tests.tests.map((t, i) => {
        const observed = observations?.[i];
        const pass = compareObservation(tests.problemNumber, observed, t.expected);
        return { id: t.id, pass: !!pass, observed };
    });
    const infrastructure = execution.status === 'infrastructure_error';
    results.push({
        id: c.id,
        status: infrastructure
            ? 'infrastructure_failure'
            : execution.status === 'completed' &&
                execution.exitCode === 0 &&
                checks.every((t) => t.pass)
              ? 'pass'
              : 'fail',
        passed: checks.filter((t) => t.pass).length,
        total: checks.length,
        execution,
        checks,
    });
    await writeFile(
        join(directory, 'hidden-grades.json'),
        JSON.stringify(
            {
                budget: 'production Python sandbox: 3s and 128MiB per case batch, no network, no answer files; not protocol proposed per-input budget',
                results,
            },
            null,
            2,
        ),
    );
    console.log(c.id, results.at(-1).status, results.at(-1).passed + '/' + checks.length);
}
await writeFile(
    join(directory, 'hidden-grades.json'),
    JSON.stringify(
        { budget: 'production Python sandbox: 3s and 128MiB per case batch', results },
        null,
        2,
    ),
);
