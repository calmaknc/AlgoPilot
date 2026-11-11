import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getPracticeNote, searchPracticeNotes } from '../src/storage/practice-notes.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import assert from 'node:assert/strict';
import { createEvaluationTools } from './tool-adapter.mjs';
import { createAgentTools } from '../src/tools/index.ts';
import { createAgentService } from '../src/agent/service.ts';
import { requestModel } from '../src/agent/runner.ts';

const base = new URL('./', import.meta.url);
const suite = JSON.parse(await readFile(new URL('cases.json', base), 'utf8'));
const fixtures = JSON.parse(await readFile(new URL('fixtures/notes.json', base), 'utf8'));
const args = process.argv.slice(2);
const group = args[0] === '--group' ? args[1] : undefined;
if (group) assert(Object.hasOwn(suite.groups, group), 'Unknown group');
const requestedIds = group ? args.slice(2) : args;
for (const id of requestedIds)
    assert(
        suite.cases.some((item) => item.id === id),
        `Unknown case: ${id}`,
    );
const selectedCases = suite.cases.filter(
    (item) =>
        (!group || suite.groups[group].includes(item.id)) &&
        (!requestedIds.length || requestedIds.includes(item.id)),
);
assert(selectedCases.length > 0, 'No cases selected');
const runId = new Date().toISOString().replaceAll(':', '-');
const reports = new URL(`runs/${runId}/`, base);
await mkdir(reports, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'mini-agent-real-eval-'));
const hash = (data) => createHash('sha256').update(data).digest('hex');

async function snapshot(root) {
    const result = {};
    async function walk(dir, prefix = '') {
        let entries;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            const rel = prefix + entry.name;
            if (entry.isDirectory()) await walk(join(dir, entry.name), rel + '/');
            else if (entry.isFile()) result[rel] = hash(await readFile(join(dir, entry.name)));
        }
    }
    await walk(root);
    return result;
}

async function memorySnapshot(directory) {
    const hashes = await snapshot(directory);
    const contents = {};
    for (const path of Object.keys(hashes))
        contents[path] = await readFile(join(directory, path), 'utf8');
    return contents;
}

async function notesAt(directory) {
    const url = pathToFileURL(directory + '/');
    const { matches } = await searchPracticeNotes({ limit: Number.MAX_SAFE_INTEGER }, url);
    return Promise.all(
        matches
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((note) => getPracticeNote(note.id, url)),
    );
}
const protectedRoots = [
    fileURLToPath(new URL('../data/', base)),
    process.env.EVAL_SOURCE_ROOT ?? '/home/nijunjie/文档/leetcode',
];
const runtimeHashes = await snapshot(fileURLToPath(new URL('../src/', base)));
const datasetHashes = Object.fromEntries(
    Object.entries(await snapshot(fileURLToPath(base))).filter(
        ([p]) => !p.startsWith('runs/') && !p.startsWith('REPORT-'),
    ),
);
const beforeProtected = await Promise.all(protectedRoots.map(snapshot));
const manifest = {
    runnerVersion: '1.5.0',
    benchmarkVersion: suite.version,
    group: group ?? 'all',
    runtimeHashes,
    datasetHashes,
    runId,
    startedAt: new Date().toISOString(),
    tempDirectory: temp,
    selectedCaseIds: selectedCases.map((item) => item.id),
    fixturesSha256: hash(await readFile(new URL('fixtures/notes.json', base))),
    model: process.env.DEEPSEEK_MODEL,
    memoryModel: process.env.MEMORY_MODEL ?? process.env.DEEPSEEK_MODEL,
    reasoningEffort: 'high',
    maxNormalModelRoundsPerTurn: 12,
    finalReplyOnlyRound: 12,
    modelRequestTimeoutMs: 60000,
    perTurnTimeoutMs: 240000,
    perEpisodeTimeoutMs: 1200000,
    gitCommit: process.env.EVAL_GIT_COMMIT ?? null,
    dryRun: process.env.EVAL_DRY_RUN === '1',
    codeHashes: Object.fromEntries(
        await Promise.all(
            [
                'src/storage/practice-notes.ts',
                'src/agent/runner.ts',
                'src/tools/index.ts',
                'src/tools/implementations.ts',
                'evals/cases.json',
                'evals/run-live.mjs',
            ].map(async (p) => [p, hash(await readFile(new URL('../' + p, base)))]),
        ),
    ),
    protectedRoots,
    beforeProtected,
    results: [],
};
const save = () => writeFile(new URL('manifest.json', reports), JSON.stringify(manifest, null, 2));
await save();
await writeFile(new URL('cases.snapshot.json', reports), JSON.stringify(suite, null, 2));
console.log(JSON.stringify({ reports: fileURLToPath(reports), temp, model: manifest.model }));
try {
    for (const item of selectedCases) {
        const caseDirectory = join(temp, item.id);
        const notesDirectory = join(caseDirectory, 'notes');
        const exportsDirectory = join(caseDirectory, 'exports');
        const conversationsDirectory = join(caseDirectory, 'conversations');
        for (const dir of [notesDirectory, exportsDirectory, conversationsDirectory])
            await mkdir(dir, { recursive: true });
        // 初始化隔离的 SQLite 库，再按评测固定 ID 与时间写入夹具。
        await searchPracticeNotes({}, pathToFileURL(notesDirectory + '/'));
        const db = new DatabaseSync(join(notesDirectory, 'notes.sqlite'));
        try {
            const insert = db.prepare(
                'INSERT INTO notes (id, title, content, tags, problem, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            );
            for (const id of item.initialNoteIds) {
                const fixture = fixtures.find((note) => note.id === id);
                assert(fixture);
                insert.run(
                    fixture.id,
                    fixture.title,
                    fixture.content,
                    JSON.stringify(fixture.tags),
                    fixture.problem === undefined ? null : JSON.stringify(fixture.problem),
                    fixture.createdAt,
                    fixture.updatedAt,
                );
            }
        } finally {
            db.close();
        }
        const originalTools = createAgentTools({
            notesDirectory: pathToFileURL(notesDirectory + '/'),
            exportsDirectory: pathToFileURL(exportsDirectory + '/'),
        });
        const faultEvents = [];
        const tools = createEvaluationTools(originalTools, {
            fault: item.fault,
            network: suite.defaults.network,
            onFault(event) {
                faultEvents.push(event);
                appendFileSync(
                    new URL(`${item.id}.faults.jsonl`, reports),
                    JSON.stringify(event) + '\n',
                );
            },
        });
        const service = createAgentService({
            directory: pathToFileURL(conversationsDirectory + '/'),
            runModel: (messages, onChunk, onTool, signal, onModelCall, onMemory) =>
                process.env.EVAL_DRY_RUN === '1'
                    ? Promise.resolve('[DRY RUN: no model called]')
                    : requestModel(messages, onChunk, onTool, signal, onModelCall, tools, {
                          directory: pathToFileURL(join(caseDirectory, 'context') + '/'),
                          memoryDirectory: pathToFileURL(join(caseDirectory, 'memory') + '/'),
                          onMemory,
                      }),
        });
        const sessions = new Map();
        const episodeStart = performance.now();
        for (const turn of item.turns) {
            if (!sessions.has(turn.session))
                sessions.set(
                    turn.session,
                    await service.newConversation(item.id + '-' + turn.session),
                );
            const conversation = sessions.get(turn.session);
            const turnId = item.id + '-turn-' + turn.turn;
            const tracePath = fileURLToPath(new URL(`${turnId}.trace.jsonl`, reports));
            const result = {
                id: turnId,
                caseId: item.id,
                turn: turn.turn,
                session: turn.session,
                beforeMemory: await memorySnapshot(join(caseDirectory, 'memory')),
                prompt: await readFile(new URL(turn.inputFile, base), 'utf8'),
                startedAt: new Date().toISOString(),
                beforeNotes: await notesAt(notesDirectory),
                tools: [],
                modelCalls: [],
                reply: '',
                error: null,
            };
            const start = performance.now();
            const trace = (event) =>
                appendFileSync(
                    tracePath,
                    JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n',
                );
            trace({ type: 'input', content: result.prompt });
            console.log('START ' + item.id);
            try {
                const response = await service.run(conversation.id, result.prompt, {
                    signal: AbortSignal.timeout(
                        Math.max(1, Math.min(240000, 1200000 - (performance.now() - episodeStart))),
                    ),
                    onMemory(event) {
                        trace({ type: 'memory', event });
                    },
                    onChunk(text) {
                        result.reply += text;
                        trace({ type: 'text', text });
                    },
                    onTool(name, argumentsJson, output, record) {
                        const entry = { name, argumentsJson, output, record };
                        result.tools.push(entry);
                        trace({ type: 'tool', ...entry });
                        console.log(`TOOL ${item.id} ${name} ${record?.status}`);
                    },
                    onModelCall(record) {
                        result.modelCalls.push(record);
                        trace({ type: 'model', ...record });
                        console.log(
                            `MODEL ${item.id} round=${record.round} tokens=${record.usage?.totalTokens ?? 'unknown'}`,
                        );
                    },
                });
                result.reply = response.reply;
                result.conversation = response.conversation;
                result.memoryEvents = response.memoryEvents;
            } catch (error) {
                result.error = { name: error.name, code: error.code, message: error.message,
                    cause: error.cause ? { name: error.cause.name, code: error.cause.code, message: error.cause.message } : undefined };
                trace({ type: 'error', ...result.error });
            }
            result.durationMs = Math.round(performance.now() - start);
            result.afterNotes = await notesAt(notesDirectory);
            result.afterMemory = await memorySnapshot(join(caseDirectory, 'memory'));
            result.exports = await memorySnapshot(exportsDirectory);
            result.faultEvents = [...faultEvents];
            const calls = result.modelCalls;
            result.usage =
                calls.length && !result.error && calls.every((c) => c.usage)
                    ? calls.reduce(
                          (a, c) => ({
                              inputTokens: a.inputTokens + c.usage.inputTokens,
                              outputTokens: a.outputTokens + c.usage.outputTokens,
                              totalTokens: a.totalTokens + c.usage.totalTokens,
                          }),
                          { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                      )
                    : null;
            result.observedUsage = calls
                .filter((c) => c.usage)
                .reduce((a, c) => a + c.usage.totalTokens, 0);
            result.requiredToolsPresentThisTurn = item.requiredTools.every((name) =>
                result.tools.some((tool) => tool.name === name),
            );
            await writeFile(new URL(`${turnId}.json`, reports), JSON.stringify(result, null, 2));
            manifest.results.push({
                id: result.id,
                error: result.error,
                durationMs: result.durationMs,
                usage: result.usage,
                observedUsage: result.observedUsage,
                modelCalls: result.modelCalls.length,
                tools: result.tools.map((t) => t.name),
                requiredToolsPresentThisTurn: result.requiredToolsPresentThisTurn,
            });
            await save();
            console.log('DONE ' + JSON.stringify(manifest.results.at(-1)));
            const now = await Promise.all(protectedRoots.map(snapshot));
            assert.deepEqual(
                now,
                beforeProtected,
                'Protected data changed during evaluation; stopping',
            );
            if (result.error) break;
        }
    }
} finally {
    manifest.finishedAt = new Date().toISOString();
    manifest.afterProtected = await Promise.all(protectedRoots.map(snapshot));
    manifest.protectedDataUnchanged =
        JSON.stringify(manifest.beforeProtected) === JSON.stringify(manifest.afterProtected);
    await save();
    console.log('PROTECTED_DATA_UNCHANGED ' + manifest.protectedDataUnchanged);
}
