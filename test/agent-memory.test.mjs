import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMemoryStore } from '../src/agent/memory-store.ts';
import { createAgentService } from '../src/agent/service.ts';
process.env.DEEPSEEK_API_KEY='local-test-placeholder';process.env.DEEPSEEK_MODEL='local-test-model';
let handler;
globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://api.deepseek.com/responses');return handler(JSON.parse(options.body));};
const {requestModel}=await import('../src/agent/runner.ts');
function stream(text,output=[]) {
    const events=[{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}];
    return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
}
function answer(value) {return Response.json({id:'memory',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:2,output_tokens:2,total_tokens:4}});}
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'agent-memory-'));try{await fn(pathToFileURL(root+'/'));}finally{await rm(root,{recursive:true,force:true});}}
const draft={name:'user-tabs',description:'使用 tab 缩进',type:'user',content:'默认使用 tab。',evidence:'请记住用 tab'};
const noTools={toolDefinitions:[],executeTool:async()=>{assert.fail('不应执行工具');}};

test('空记忆首轮末总结，下一会话轻量召回；索引在系统提示词，正文只注入输入副本',async()=>fixture(async directory=>{
    const events=[],records=[];let calls=[];
    handler=body=>{
        if(body.stream){calls.push('answer');assert.match(body.instructions,/长期记忆目录/);return stream('将记录你的偏好。');}
        calls.push('extract');assert.equal(body.tools,undefined);return answer({upsert:[draft],remove:[]});
    };
    const messages=[{role:'user',content:'请记住用 tab'}];
    assert.equal(await requestModel(messages,undefined,undefined,undefined,record=>records.push(record),noTools,{memoryDirectory:directory,onMemory:event=>events.push(event)}),'将记录你的偏好。');
    assert.deepEqual(calls,['answer','extract']);assert.equal(records.length,2);
    assert.equal(events.at(-1).status,'success');assert.equal((await createMemoryStore(directory).read()).memories.length,1);
    calls=[];
    handler=body=>{
        if(body.stream){calls.push('answer');assert.match(body.instructions,/user-tabs.*entries/);assert.match(body.input.at(-1).content,/默认使用 tab/);assert(body.input.at(-1).content.endsWith('当前用户要求：\n这次用四个空格'));return stream('本次使用四个空格。');}
        const data=JSON.parse(body.input[0].content);
        if('index' in data){calls.push('recall');assert.match(data.index,/user-tabs/);assert.equal(data.recent.at(-1).content,'这次用四个空格');return answer({names:['user-tabs']});}
        calls.push('extract');assert.equal(data.recent.at(-2).content,'这次用四个空格');return answer({upsert:[],remove:[]});
    };
    const current=[{role:'user',content:'这次用四个空格'}];
    await requestModel(current,undefined,undefined,undefined,undefined,noTools,{memoryDirectory:directory});
    assert.deepEqual(calls,['recall','answer','extract']);assert.deepEqual(current,[{role:'user',content:'这次用四个空格'}]);
}));

test('工具循环期间不总结，无 tool use 的最终回答后恰好总结一次，原始用户内容持久化',async()=>fixture(async directory=>{
    let calls=[],executed=0;
    const tools={toolDefinitions:[],executeTool:async()=>{executed++;return '{"ok":true,"path":"src/agent/runner.ts"}';}};
    handler=body=>{
        if(!body.stream){calls.push('extract');const data=JSON.parse(body.input[0].content);assert.equal(data.toolEvidence.length,1);assert.equal(data.recent.at(-1).content,'先检查。已检查。');return answer({upsert:[draft],remove:[]});}
        calls.push('answer');return executed?stream('已检查。'):stream('先检查。',[{type:'function_call',call_id:'a',name:'test',arguments:'{}'}]);
    };
    const service=createAgentService({directory:new URL('conversations/',directory),runModel:(messages,onChunk,onTool,signal,onModelCall,onMemory)=>requestModel(messages,onChunk,onTool,signal,onModelCall,tools,{memoryDirectory:new URL('memory/',directory),onMemory})});
    const conversation=await service.newConversation();
    const result=await service.run(conversation.id,'请记住用 tab');
    assert.deepEqual(calls,['answer','answer','extract']);assert.equal(executed,1);
    const saved=await service.getConversation(conversation.id);
    assert.equal(saved.messages[0].content,'请记住用 tab');assert.equal(saved.messages[1].metrics.modelCalls.length,3);
    assert(result.memoryEvents.some(event=>event.phase==='extract'&&event.status==='success'));
}));

test('记忆写入模型失败仍返回答案并展示警告；主请求失败不总结记忆',async()=>fixture(async directory=>{
    const events=[];let summaries=0;
    handler=body=>{if(body.stream)return stream('正常回答');summaries++;return Response.json({error:{message:'memory model unavailable'}},{status:503});};
    assert.equal(await requestModel([{role:'user',content:'请记住用 tab'}],undefined,undefined,undefined,undefined,noTools,{memoryDirectory:directory,onMemory:event=>events.push(event)}),'正常回答');
    assert.equal(summaries,1);assert.equal(events.at(-1).status,'warning');assert.equal((await createMemoryStore(directory).read()).memories.length,0);
    summaries=0;
    handler=body=>{if(!body.stream)summaries++;return Response.json({error:{message:'main model unavailable'}},{status:503});};
    await assert.rejects(requestModel([{role:'user',content:'请记住用 tab'}],undefined,undefined,undefined,undefined,noTools,{memoryDirectory:directory}));
    assert.equal(summaries,0);
}));

test('召回失败不使用旧记忆正文，仍执行轮末总结；取消主回答不更新记忆',async()=>fixture(async directory=>{
    const store=createMemoryStore(directory);const snapshot=await store.read();await store.replace(snapshot.revision,[{...draft,createdAt:'2026-10-26T00:00:00Z',updatedAt:'2026-10-26T00:00:00Z'}]);
    let summaries=0;const events=[];
    handler=body=>{
        if(body.stream){assert.equal(body.input.at(-1).content,'继续');return stream('正常回答');}
        const input=JSON.parse(body.input[0].content);
        if('index' in input)return answer({names:['nonexistent']});
        summaries++;return answer({upsert:[],remove:[]});
    };
    await requestModel([{role:'user',content:'继续'}],undefined,undefined,undefined,undefined,noTools,{memoryDirectory:directory,onMemory:event=>events.push(event)});
    assert.equal(summaries,1);assert(events.some(event=>event.phase==='recall'&&event.status==='warning'));
    const controller=new AbortController();summaries=0;
    handler=body=>{if(body.stream)return stream('部分回答');const input=JSON.parse(body.input[0].content);if('index'in input)return answer({names:['user-tabs']});summaries++;return answer({upsert:[],remove:[]});};
    await assert.rejects(requestModel([{role:'user',content:'继续'}],()=>controller.abort(),undefined,controller.signal,undefined,noTools,{memoryDirectory:directory}),{name:'AbortError'});
    assert.equal(summaries,0);
}));
