import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createContextCompressor, recentContext, compactEarlierResults, TOOL_RESULT_PLACEHOLDER, isContextLimitError, ContextLimitError } from '../src/agent/context-compression.ts';

const messages = n => Array.from({length:n}, (_,i)=>({role:i%2?'assistant':'user', content:`message ${i}`}));
const call = id => ({type:'function_call',call_id:id,name:'test',arguments:'{}'});
const output = (id, text=id) => ({type:'function_call_output',call_id:id,output:text});
async function fixture(fn) {
    const root = await mkdtemp(join(tmpdir(),'context-test-'));
    try { await fn(pathToFileURL(root+'/'), root); } finally { await rm(root,{recursive:true,force:true}); }
}

test('裁剪保留最近消息、当前用户要求及系统约束，所有工具协议块完整', () => {
    assert.deepEqual(recentContext(messages(80),50),messages(80).slice(-50));
    const history = [...messages(60), {role:'user',content:'不要改我的代码'}, {type:'reasoning',id:'r',summary:[]}, call('a'),call('b'),output('a'),output('b')];
    const original = structuredClone(history);
    for (let limit=1;limit<12;limit++) {
        const tail=recentContext(history,limit);
        assert(tail.some(item=>item.content==='不要改我的代码'));
        assert.deepEqual(tail.filter(item=>item.type==='function_call').map(item=>item.call_id), ['a','b']);
        assert.deepEqual(tail.filter(item=>item.type==='function_call_output').map(item=>item.call_id), ['a','b']);
        assert(tail.some(item=>item.type==='reasoning'));
    }
    const system={role:'system',content:'约束'};
    assert.equal(recentContext([system,...history],1)[0],system);
    assert.deepEqual(history,original);
    const interleaved=[...messages(10),call('x'),{role:'assistant',content:'处理中'},output('x')];
    assert(recentContext(interleaved,1).some(item=>item.type==='function_call' && item.call_id==='x'));
    assert.throws(()=>recentContext([output('orphan')],1),/缺少匹配调用/);
});

test('旧工具结果替换占位符，最近三个与 call_id 原样保留', () => {
    const history=[...messages(4),...['a','b','c','d','e'].flatMap(id=>[call(id),output(id)])];
    const compacted=compactEarlierResults(history);
    assert.deepEqual(compacted.filter(item=>item.type==='function_call_output').map(item=>item.output),[TOOL_RESULT_PLACEHOLDER,TOOL_RESULT_PLACEHOLDER,'c','d','e']);
    assert.equal(history.at(5).output,'a');
});

test('超过 200kB 按 UTF-8 字节落盘，2000 字符预览不拆 Unicode，相同结果不重复写', async () => fixture(async directory => {
    const compressor=createContextCompressor({directory,summarize:async()=>{throw new Error('不应总结');}});
    const text='😀'.repeat(50001);
    const history=[call('../unsafe'),output('../unsafe',text),output('small','x'.repeat(200000))];
    const result=await compressor.offload(history);
    const [folder]=await readdir(directory);
    const folderUrl=new URL(folder+'/',directory);
    const [file]=await readdir(folderUrl);
    assert.equal(await readFile(new URL(file,folderUrl),'utf8'),text);
    assert.equal(result[1].output.split('\n')[0],'😀'.repeat(2000));
    assert.equal(result[2].output,history[2].output);
    assert.deepEqual(await compressor.offload(history),result);
    assert.equal((await readdir(folderUrl)).length,1);
}));

test('恢复顺序：落盘→50条→旧结果替换→备份后总结，摘要不替换当前用户要求', async () => fixture(async directory => {
    const history=[...messages(70), {role:'user',content:'只给提示'}, ...['a','b','c','d'].flatMap(id=>[call(id),output(id)])];
    let summaryCalls=0;
    const compressor=createContextCompressor({directory,summarize:async source=>{
        summaryCalls++;
        const [folder]=await readdir(directory);
        const files=await readdir(new URL(folder+'/',directory));
        const backup=files.find(file=>file.startsWith('history-'));
        assert.deepEqual(JSON.parse(await readFile(new URL(folder+'/'+backup,directory),'utf8')),history);
        assert(source.some(item=>item.content==='message 0'));
        return '目标：学习；约束：只给提示';
    }});
    let input=await compressor.recover(history,history);
    assert.deepEqual(input,history);
    input=await compressor.recover(input,history);
    assert.equal(input.length,50);
    input=await compressor.recover(input,history);
    assert.equal(input.find(item=>item.type==='function_call_output').output,TOOL_RESULT_PLACEHOLDER);
    input=await compressor.recover(input,history);
    assert.equal(summaryCalls,1);
    assert.equal(input[0].role,'assistant');
    assert.match(input[0].content,/目标/);
    assert(input.some(item=>item.content==='只给提示'));
    assert.equal(input.filter(item=>item.type==='function_call_output').length,4);
}));

test('总结失败最多三次，随后一次最终裁剪，再超限明确停止', async () => fixture(async directory => {
    const history=messages(80);let attempts=0;
    const sizes=[];
    const compressor=createContextCompressor({directory,summarize:async source=>{attempts++;sizes.push(source.length);throw new Error('API 故障');}});
    let input=history;
    for(let i=0;i<4;i++) input=await compressor.recover(input,history);
    assert.equal(attempts,3);assert.deepEqual(sizes,[80,50,6]);assert.equal(input.length,6);
    await assert.rejects(compressor.recover(input,history),ContextLimitError);
    assert.equal(attempts,3);
}));

test('成功摘要仍超限时共享三次预算，不无限总结；取消与落盘失败不继续', async () => fixture(async (directory,root) => {
    let attempts=0;const history=messages(80);
    const compressor=createContextCompressor({directory,summarize:async()=>{attempts++;return '摘要';}});
    let input=history;
    for(let i=0;i<7;i++)input=await compressor.recover(input,history);
    assert.equal(attempts,3);assert.equal(input.length,6);
    await assert.rejects(compressor.recover(input,history),ContextLimitError);
    const controller=new AbortController();controller.abort();
    await assert.rejects(compressor.offload([output('a','x'.repeat(200001))],controller.signal),{name:'AbortError'});
    await writeFile(join(root,'blocker'),'x');
    const broken=createContextCompressor({directory:new URL('blocker/',directory),summarize:async()=>{assert.fail('不应总结');}});
    await assert.rejects(broken.offload([output('a','x'.repeat(200001))]));
}));

test('只识别上下文超限，不把普通 400、限流、超时或输出截断当作上下文错误', () => {
    assert(isContextLimitError({code:'context_length_exceeded'}));
    assert(isContextLimitError({error:{message:"This model's maximum context length is 64000 tokens"}}));
    for(const error of [{status:400},{code:'rate_limit_exceeded'},{message:'timeout'},{code:'max_output_tokens'},null])assert.equal(isContextLimitError(error),false);
});

test('总结中取消立即停止，不运行下一次总结或最终裁剪', async () => fixture(async directory => {
    const controller=new AbortController();let attempts=0;
    const compressor=createContextCompressor({directory,summarize:async()=>{attempts++;controller.abort();throw new Error('abort');}});
    let input=messages(80);
    for(let i=0;i<3;i++)input=await compressor.recover(input,messages(80));
    await assert.rejects(compressor.recover(input,messages(80),controller.signal),{name:'AbortError'});
    assert.equal(attempts,1);
}));

test('压缩耗尽向服务暴露明确错误，失败轮不写历史，后续可继续交互', async () => fixture(async directory => {
    const { createAgentService }=await import('../src/agent/service.ts');
    let fail=true;
    const service=createAgentService({directory,runModel:async()=>{if(fail)throw new ContextLimitError();return '完成';}});
    const conversation=await service.newConversation();
    await assert.rejects(service.run(conversation.id,'继续'),error=>error.code==='CONTEXT_LIMIT');
    assert.deepEqual((await service.getConversation(conversation.id)).messages,[]);
    fail=false;
    assert.equal((await service.run(conversation.id,'继续')).reply,'完成');
}));
