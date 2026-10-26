import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createAgentTools } from '../../src/tools/index.ts';
import { createAgentService } from '../../src/agent/service.ts';
import { requestModel } from '../../src/agent/runner.ts';

const base = new URL('./', import.meta.url);
const suite = JSON.parse(await readFile(new URL('cases.json', base), 'utf8'));
const fixtures = JSON.parse(await readFile(new URL('fixtures.json', base), 'utf8'));
const requestedIds = process.argv.slice(2);
for (const id of requestedIds) assert(suite.cases.some(item => item.id === id), `Unknown case: ${id}`);
const selectedCases = requestedIds.length ? suite.cases.filter(item => requestedIds.includes(item.id)) : suite.cases;
const runId = new Date().toISOString().replaceAll(':', '-');
const reports = new URL(`runs/${runId}/`, base);
await mkdir(reports, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'mini-agent-real-eval-'));
const hash = data => createHash('sha256').update(data).digest('hex');
async function snapshot(root) {
    const result = {};
    async function walk(dir, prefix = '') {
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
            const rel = prefix + entry.name;
            if (entry.isDirectory()) await walk(join(dir,entry.name), rel + '/');
            else if (entry.isFile()) result[rel] = hash(await readFile(join(dir,entry.name)));
        }
    }
    await walk(root); return result;
}
async function notesAt(directory) {
    return Promise.all((await readdir(directory)).filter(n => /^note_.*\.json$/.test(n)).sort()
        .map(async n => JSON.parse(await readFile(join(directory,n),'utf8'))));
}
const protectedRoots = [fileURLToPath(new URL('../../data/', base)), ...(process.env.EVAL_SOURCE_ROOT ? [process.env.EVAL_SOURCE_ROOT] : [])];
const beforeProtected = await Promise.all(protectedRoots.map(snapshot));
const manifest = {
    runId, startedAt: new Date().toISOString(), tempDirectory: temp,
    selectedCaseIds: selectedCases.map(item => item.id),
    fixturesSha256: hash(await readFile(new URL('fixtures.json', base))),
    model: process.env.DEEPSEEK_MODEL, reasoningEffort: 'high', maxModelCalls: 5,
    modelRequestTimeoutMs: 60000, perCaseTimeoutMs: 240000,
    gitCommit: execFileSync('git', ['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    codeHashes: Object.fromEntries(await Promise.all(['src/agent/runner.ts','src/tools/index.ts','src/tools/implementations.ts','evals/leetcode-real-notes/cases.json','evals/leetcode-real-notes/run-live.mjs'].map(async p => [p,hash(await readFile(new URL('../../'+p,base)))]))),
    protectedRoots, beforeProtected, results: []
};
const save = () => writeFile(new URL('manifest.json',reports),JSON.stringify(manifest,null,2));
await save();
console.log(JSON.stringify({reports:fileURLToPath(reports),temp,model:manifest.model}));
try {
    for (const item of selectedCases) {
        const caseDirectory = join(temp,item.id);
        const notesDirectory = join(caseDirectory,'notes');
        const exportsDirectory = join(caseDirectory,'exports');
        const conversationsDirectory = join(caseDirectory,'conversations');
        for (const dir of [notesDirectory,exportsDirectory,conversationsDirectory]) await mkdir(dir,{recursive:true});
        for (const id of item.initialNoteIds) {
            const fixture = fixtures.find(note => note.id === id);
            assert(fixture);
            await writeFile(join(notesDirectory,`note_${id}.json`),JSON.stringify(fixture,null,2));
        }
        const tools = createAgentTools({notesDirectory:pathToFileURL(notesDirectory+'/'),exportsDirectory:pathToFileURL(exportsDirectory+'/')});
        const service = createAgentService({directory:pathToFileURL(conversationsDirectory+'/'),runModel:(messages, onChunk, onTool, signal, onModelCall, onMemory) => requestModel(messages, onChunk, onTool, signal, onModelCall, tools, { directory: pathToFileURL(join(caseDirectory, 'context') + '/'), memoryDirectory: pathToFileURL(join(caseDirectory, 'memory') + '/'), onMemory })});
        const conversation = await service.newConversation(item.id);
        const tracePath = fileURLToPath(new URL(`${item.id}.trace.jsonl`,reports));
        const result = {id:item.id,prompt:await readFile(new URL(item.inputFile,base),'utf8'),
            startedAt:new Date().toISOString(),beforeNotes:await notesAt(notesDirectory),tools:[],modelCalls:[],reply:'',error:null};
        const start = performance.now();
        const trace = event => appendFileSync(tracePath,JSON.stringify({at:new Date().toISOString(),...event})+'\n');
        trace({type:'input',content:result.prompt});
        console.log('START '+item.id);
        try {
            const response = await service.run(conversation.id,result.prompt,{
                signal:AbortSignal.timeout(240000),
                onChunk(text) { result.reply += text; trace({type:'text',text}); },
                onTool(name,argumentsJson,output,record) {
                    const entry={name,argumentsJson,output,record};result.tools.push(entry);trace({type:'tool',...entry});
                    console.log(`TOOL ${item.id} ${name} ${record?.status}`);
                },
                onModelCall(record) {result.modelCalls.push(record);trace({type:'model',...record});console.log(`MODEL ${item.id} round=${record.round} tokens=${record.usage?.totalTokens ?? 'unknown'}`);}
            });
            result.reply = response.reply;
            result.conversation = response.conversation;
        } catch(error) {
            result.error={name:error.name,message:error.message};trace({type:'error',...result.error});
        }
        result.durationMs=Math.round(performance.now()-start);
        result.afterNotes=await notesAt(notesDirectory);
        const calls=result.modelCalls;
        result.usage=calls.length && !result.error && calls.every(c=>c.usage) ? calls.reduce((a,c)=>({inputTokens:a.inputTokens+c.usage.inputTokens,outputTokens:a.outputTokens+c.usage.outputTokens,totalTokens:a.totalTokens+c.usage.totalTokens}),{inputTokens:0,outputTokens:0,totalTokens:0}) : null;
        result.observedUsage=calls.filter(c=>c.usage).reduce((a,c)=>a+c.usage.totalTokens,0);
        result.requiredToolsPresent=item.requiredTools.every(name=>result.tools.some(tool=>tool.name===name));
        await writeFile(new URL(`${item.id}.json`,reports),JSON.stringify(result,null,2));
        manifest.results.push({id:result.id,error:result.error,durationMs:result.durationMs,usage:result.usage,observedUsage:result.observedUsage,modelCalls:result.modelCalls.length,tools:result.tools.map(t=>t.name),requiredToolsPresent:result.requiredToolsPresent});
        await save();
        console.log('DONE '+JSON.stringify(manifest.results.at(-1)));
        const now = await Promise.all(protectedRoots.map(snapshot));
        assert.deepEqual(now,beforeProtected,'Protected data changed during evaluation; stopping');
    }
} finally {
    manifest.finishedAt=new Date().toISOString();
    manifest.afterProtected=await Promise.all(protectedRoots.map(snapshot));
    manifest.protectedDataUnchanged=JSON.stringify(manifest.beforeProtected)===JSON.stringify(manifest.afterProtected);
    await save();
    console.log('PROTECTED_DATA_UNCHANGED '+manifest.protectedDataUnchanged);
}
