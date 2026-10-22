import assert from 'node:assert/strict';
import test from 'node:test';

// 替换网络层，测试完整 SDK 流式解析和 Agent 循环，不读取真实密钥。
process.env.DEEPSEEK_API_KEY = 'local-test-placeholder';
process.env.DEEPSEEK_MODEL = 'local-test-model';
let handler;
globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.deepseek.com/responses');
    return handler(JSON.parse(options.body), options);
};
const { requestModel } = await import('../src/agent/runner.ts');
const { executeTool } = await import('../src/tools/index.ts');

function response(output, text = '', status = 'completed') {
    const events = [];
    for (const delta of text) {
        events.push({ type: 'response.output_text.delta', delta });
    }
    if (status !== 'disconnected') {
        events.push({
            type: `response.${status}`,
            response: {
                status, output,
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
