import assert from 'node:assert/strict';
import test from 'node:test';

// 替换网络层，测试完整 SDK 流式解析和 Agent 循环，不读取真实密钥。
process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
process.env.DEEPSEEK_MODEL = 'local-test-model';
let handler;
let webHandler;
globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.deepseek.com/v1/tools/')) return webHandler(url, JSON.parse(options.body));
    assert.equal(String(url), 'https://api.deepseek.com/responses');
    return handler(JSON.parse(options.body), options);
};
const { requestModel: requestModelWithMemory } = await import('../src/agent/runner.ts');
// 既有 Agent/压缩回归隔离长期记忆；记忆链路由独立测试覆盖。
const requestModel = (...args) => {
    args[6] = { ...args[6], memory: false };
    return requestModelWithMemory(...args);
};
const { executeTool } = await import('../src/tools/index.ts');

test('评测可以注入独立工具注册表，模型调用不会落回默认工具', async () => {
    let executed = false;
    handler = body => {
        assert.deepEqual(body.tools.map(tool => tool.name), ['isolated_tool']);
        if (!executed) return response([call('isolated', '{}', 'isolated_tool')]);
        assert.equal(body.input.at(-1).output, '{"ok":true,"isolated":true}');
        return response([], '隔离工具执行完成');
    };
    const tools = {
        toolDefinitions: [{ type: 'function', name: 'isolated_tool', description: 'test', parameters: {} }],
        executeTool: async name => {
            assert.equal(name, 'isolated_tool');
            executed = true;
            return '{"ok":true,"isolated":true}';
        },
    };
    assert.equal(await requestModel([{role:'user',content:'test'}], undefined, undefined, undefined, undefined, tools), '隔离工具执行完成');
    assert(executed);
});

function response(output, text = '', status = 'completed', usage) {
    const events = [];
    for (const delta of text) {
        events.push({ type: 'response.output_text.delta', delta });
    }
    if (status !== 'disconnected') {
        events.push({
            type: `response.${status}`,
            response: {
                status, output, usage,
                incomplete_details: { reason: 'max_output_tokens' },
                error: { message: '模拟失败' }
            }
        });
    }
    return new Response(events.map(event =>
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    ).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
}

function call(id, args, name = 'get_current_time') {
    return { type: 'function_call', call_id: id, name, arguments: args };
}

test('参数校验：有效时区、无效时区、坏 JSON、未知工具和额外字段', async () => {
    assert.equal(JSON.parse(await executeTool('get_current_time', '{"timezone":"Asia/Shanghai"}')).ok, true);
    for (const args of ['{', 'null', '[]', '{}', '{"timezone":1}', '{"timezone":"Bad/Zone"}', '{"timezone":"UTC","extra":1}']) {
        assert.equal(JSON.parse(await executeTool('get_current_time', args)).ok, false);
    }
    assert.equal(JSON.parse(await executeTool('unknown', '{}')).ok, false);
});

test('普通回答、多个工具、参数修正、轮数限制及流错误', async () => {
    const messages = [{ role: 'user', content: '现在几点？' }];
    const original = structuredClone(messages);
    const chunks = [];
    handler = () => response([], '你好');
    assert.equal(await requestModel(messages, text => chunks.push(text)), '你好');
    assert.deepEqual(chunks, ['你', '好']);

    let requests = 0;
    const logs = [];
    handler = body => {
        requests++;
        assert.equal(body.tools[0].name, 'get_current_time');
        if (requests === 1) {
            return response([
                call('a', '{"timezone":"Asia/Shanghai"}'),
                call('b', '{"timezone":"Europe/London"}')
            ]);
        }
        assert.deepEqual(body.input.slice(1, 3).map(item => item.call_id), ['a', 'b']);
        const outputs = body.input.filter(item => item.type === 'function_call_output');
        assert.deepEqual(outputs.map(item => item.call_id), ['a', 'b']);
        assert.ok(outputs.every(item => JSON.parse(item.output).ok));
        return response([], '查询完成');
    };
    assert.equal(await requestModel(messages, undefined, (...args) => logs.push(args)), '查询完成');
    assert.equal(requests, 2);
    assert.equal(logs.length, 2);
    assert.deepEqual(messages, original);

    requests = 0;
    handler = body => {
        requests++;
        if (requests === 1) return response([call('bad', '{')]);
        if (requests === 2) {
            assert.equal(JSON.parse(body.input.at(-1).output).ok, false);
            return response([call('fixed', '{"timezone":"UTC"}')]);
        }
        assert.equal(JSON.parse(body.input.at(-1).output).ok, true);
        return response([], '修正成功');
    };
    assert.equal(await requestModel(messages), '修正成功');

    requests = 0;
    handler = () => response([call(String(++requests), '{"timezone":"UTC"}')]);
    await assert.rejects(requestModel(messages), /5 次模型请求上限/);
    assert.equal(requests, 5);

    for (const [status, error] of [
        ['incomplete', /max_output_tokens/],
        ['failed', /模拟失败/],
        ['disconnected', /连接提前结束/]
    ]) {
        handler = () => response([], '部分文本', status);
        await assert.rejects(requestModel(messages), error);
    }
});

test('Agent 请求 Python 工具、回传 call_id 并根据执行结果回答', async () => {
    const { sandboxService } = await import('../src/sandbox/service.ts');
    const originalRun = sandboxService.run;
    let calls = 0;
    let requests = 0;
    sandboxService.run = async args => {
        calls++;
        assert.deepEqual(args, { code: 'print(1 + 2)', stdin: '' });
        return { status: 'completed', stdout: '3\n', stderr: '', exitCode: 0, durationMs: 5 };
    };
    try {
        handler = body => {
            requests++;
            assert.ok(body.tools.some(tool => tool.name === 'run_python'));
            if (requests === 1) return response([call('python-1', '{"code":"print(1 + 2)","stdin":""}', 'run_python')]);
            const output = body.input.at(-1);
            assert.equal(output.call_id, 'python-1');
            assert.equal(output.type, 'function_call_output');
            const data = JSON.parse(output.output);
            assert.equal(data.executionSucceeded, true);
            assert.equal(data.stdout, '3\n');
            return response([], '实际输出为 3，本次运行正常结束。');
        };
        assert.equal(await requestModel([{ role: 'user', content: '运行 print(1 + 2)' }]), '实际输出为 3，本次运行正常结束。');
        assert.equal(calls, 1);
        assert.equal(requests, 2);
    } finally { sandboxService.run = originalRun; }
});


test('模型取消：SDK 中断活动流，不执行后续工具或下一轮', async () => {
    const controller = new AbortController();
    let requests = 0;
    let tools = 0;
    handler = (body, options) => {
        requests++;
        return new Response(new ReadableStream({ start(stream) {
            options.signal.addEventListener('abort', () => stream.error(options.signal.reason), { once: true });
            stream.enqueue(new TextEncoder().encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"部分"}\n\n'));
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
    await assert.rejects(requestModel([{ role: 'user', content: '测试取消' }], () => controller.abort(), () => tools++, controller.signal));
    assert.equal(requests, 1);
    assert.equal(tools, 0);
});


test('记录各模型轮次真实 usage、工具 ID/状态/耗时，缺失 usage 保持未知', async () => {
    let requests = 0;
    const models = [];
    const tools = [];
    handler = () => {
        requests++;
        if (requests === 1) return response([
            call('bad-json', '{'), call('valid-time', '{"timezone":"UTC"}')
        ], '', 'completed', { input_tokens: 100, output_tokens: 20, total_tokens: 120 });
        return response([], '完成');
    };
    await requestModel([{ role: 'user', content: '查询' }], undefined,
        (name, args, output, record) => tools.push(record), undefined, record => models.push(record));
    assert.deepEqual(models.map(m => m.round), [1, 2]);
    assert.deepEqual(models[0].usage, { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
    assert.equal(models[1].usage, null);
    assert.ok(models.every(m => m.durationMs >= 0));
    assert.deepEqual(tools.map(t => [t.callId, t.round, t.status]), [
        ['bad-json', 1, 'error'], ['valid-time', 1, 'success']
    ]);
    assert.ok(tools.every(t => t.durationMs >= 0));

    const { sandboxService } = await import('../src/sandbox/service.ts');
    const original = sandboxService.run;
    sandboxService.run = async () => ({ status: 'completed', stdout: '', stderr: 'ValueError', exitCode: 1, durationMs: 2 });
    try {
        requests = 0;
        handler = () => ++requests === 1
            ? response([call('runtime-error', '{"code":"raise ValueError()"}', 'run_python')])
            : response([], '运行异常');
        await requestModel([{ role: 'user', content: '运行' }], undefined,
            (name, args, output, record) => {
                assert.equal(JSON.parse(output).ok, true);
                assert.equal(record.status, 'error');
                assert.match(record.resultStatus, /退出码 1/);
            });
    } finally { sandboxService.run = original; }
});


test('Agent 联网链路：搜索→抓取→正文回答，工具调用回传与记录', async () => {
    let requests = 0;
    const tools = [];
    webHandler = (url, body) => {
        if (url.endsWith('/search')) return Response.json({results:[{title:'1. 两数之和',url:'https://leetcode.cn/problems/two-sum/',summary:'摘要',content:''}]});
        assert.equal(body.url, 'https://leetcode.cn/problems/two-sum/');
        return Response.json({title:'1. 两数之和',content:'题干：找到两个整数。示例：nums=[2,7], target=9。约束：不能重复使用同一元素。'});
    };
    handler = body => {
        requests++;
        assert.ok(body.tools.some(tool => tool.name === 'web_search'));
        if (requests === 1) return response([call('search-1', '{"query":"1 site:leetcode.cn"}', 'web_search')]);
        const last = body.input.at(-1);
        assert.equal(JSON.parse(last.output).ok, true);
        if (requests === 2) {
            assert.equal(last.call_id, 'search-1');
            return response([call('fetch-1', '{"url":"https://leetcode.cn/problems/two-sum/"}', 'read_webpage')]);
        }
        assert.equal(last.call_id, 'fetch-1');
        assert.match(JSON.parse(last.output).content, /约束/);
        return response([], '根据题目页，不能重复使用同一元素。');
    };
    await requestModel([{role:'user',content:'查第1题'}], undefined, (name, args, output, record) => tools.push(record));
    assert.equal(requests, 3);
    assert.deepEqual(tools.map(t => [t.name,t.status,t.round]), [['web_search','success',1],['read_webpage','success',2]]);
});

async function contextFixture(fn) {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const root = await mkdtemp(join(tmpdir(), 'agent-context-'));
    try { await fn({directory:pathToFileURL(root+'/')}); }
    finally { await rm(root,{recursive:true,force:true}); }
}
function overflow() {
    return Response.json({error:{code:'context_length_exceeded',message:'maximum context length exceeded'}},{status:400});
}
function summaryResponse(text) {
    return Response.json({id:'summary',object:'response',status:'completed',output:[{
        type:'message',role:'assistant',content:[{type:'output_text',text,annotations:[]}],
    }],usage:{input_tokens:10,output_tokens:5,total_tokens:15}});
}

test('SDK 超限恢复完整链路：大结果落盘、工具不重复执行、云端总结后继续，统计包含总结', async () => contextFixture(async contextOptions => {
    const { readFile } = await import('node:fs/promises');
    let executions=0, overflows=0, summaries=0;
    const huge=JSON.stringify({ok:true,text:'中'.repeat(80000)});
    const tools={toolDefinitions:[],executeTool:async()=>{executions++;return huge;}};
    const records=[];
    const original=Array.from({length:70},(_,i)=>({role:i%2?'assistant':'user',content:`历史${i}`}));
    original.push({role:'user',content:'当前要求：只给提示'});
    handler=async body=>{
        if (body.stream===false) {
            summaries++;
            assert.equal(body.tools,undefined);
            assert.match(body.instructions,/当前目标.*重要发现.*已改文件.*剩余工作.*用户约束/);
            assert.match(body.input[0].content,/历史0/);
            return summaryResponse('目标：给提示；约束：不提供完整解法');
        }
        if (!executions) return response([call('a','{}','test'),call('b','{}','test'),call('c','{}','test'),call('d','{}','test')]);
        const results=body.input.filter(item=>item.type==='function_call_output');
        assert.equal(results.length,4);
        assert.equal(body.input.filter(item=>item.type==='function_call').length,4);
        if (!summaries) {
            if(overflows===0) {
                assert(results[0].output.length < 3000);
                const path=results[0].output.match(/Full result saved locally: (.+)\]$/)[1];
                assert.equal(await readFile(path,'utf8'),huge);
            }
            if(overflows===3) assert.equal(results[0].output,'[Earlier tool result compacted. Re-run if needed.]');
            overflows++;return overflow();
        }
        assert(body.input.some(item=>item.content==='当前要求：只给提示'));
        assert(body.input.some(item=>typeof item.content==='string' && item.content.includes('Conversation summary')));
        return response([],'提示：考虑边界');
    };
    assert.equal(await requestModel(original,undefined,undefined,undefined,record=>records.push(record),tools,contextOptions),'提示：考虑边界');
    assert.equal(executions,4);assert.equal(summaries,1);assert.equal(overflows,4);
    assert.equal(records.length,7);
    assert.deepEqual(records.map(record=>record.round),[1,2,3,4,5,6,7]);
    assert.deepEqual(records[5].usage,{inputTokens:10,outputTokens:5,totalTokens:15});
    assert.equal(original.length,71);
}));

test('SDK 持续超限最多三次总结及一次最终裁剪；普通错误不重试', async () => contextFixture(async contextOptions => {
    let requests=0,summaries=0;
    handler=body=>{
        if(body.stream===false){summaries++;return summaryResponse('摘要');}
        requests++;return overflow();
    };
    await assert.rejects(requestModel([{role:'user',content:'继续'}],undefined,undefined,undefined,undefined,undefined,contextOptions),/压缩流程已停止/);
    assert.equal(summaries,3);assert.equal(requests,8);
    requests=0;
    handler=()=>{requests++;return Response.json({error:{code:'invalid_request',message:'invalid parameter'}},{status:400});};
    await assert.rejects(requestModel([{role:'user',content:'继续'}]),/invalid parameter/);
    assert.equal(requests,1);
}));

test('流内上下文错误可恢复，但已显示文本后不重试，不重复展示', async () => contextFixture(async contextOptions => {
    let requests=0;
    const eventError=prefix=>new Response(
        (prefix ? `data: ${JSON.stringify({type:'response.output_text.delta',delta:prefix})}\n\n` : '') +
        `data: ${JSON.stringify({type:'response.failed',response:{error:{code:'context_length_exceeded',message:'too long'}}})}\n\n`,
        {headers:{'Content-Type':'text/event-stream'}});
    handler=()=>++requests===1?eventError(''):response([],'完成');
    assert.equal(await requestModel([{role:'user',content:'继续'}],undefined,undefined,undefined,undefined,undefined,contextOptions),'完成');
    assert.equal(requests,2);
    requests=0;const chunks=[];
    handler=()=>{requests++;return eventError('半截');};
    await assert.rejects(requestModel([{role:'user',content:'继续'}],chunk=>chunks.push(chunk),undefined,undefined,undefined,undefined,contextOptions),/本次响应已输出部分内容后发生上下文超限，为避免重复输出，已停止自动重试。本轮未保存。/);
    assert.deepEqual(chunks,['半截']);assert.equal(requests,1);
}));
