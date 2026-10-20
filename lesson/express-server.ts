import express, { type RequestHandler } from "express";
import { createChatService } from './chat-service.ts';
import { AppError } from './errors.ts';

const app = express();
// 所有请求共用这个实例，也共用它内部的会话忙碌集合。
const service = createChatService();

app.use(express.json({limit: '64kb'}));
app.get('/health', (req, res) => {res.json({status: 'ok'})});
app.get('/api/info', (req, res) => {res.json({name: 'mini-fastgpt', version: '0.1.0'})});
app.post('/api/echo', (req, res) => {
    const body: unknown = req.body;
    if ( typeof body !== 'object' || body === null || Array.isArray(body) ) {
        res.status(400).json({error: {code: 'INVALID_BODY', message: '正文必须是 JSON 对象'}});
        return;
    }
    if (!('message' in body) || typeof body.message !== 'string') {
        res.status(400).json({error: {code: 'INVALID_MESSAGE', message: 'message必须是字符串'}});
        return;
    }

    if (body.message.trim().length < 1 || body.message.trim().length > 10000) {
        res.status(400).json({error: {code: 'INVALID_MESSAGE', message: 'message必须是长度为1～10000的字符串'}});
        return;
    }
    res.json({received: body.message.trim()});
});

app.post('/api/conversations', async (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new AppError(400, 'INVALID_BODY', '正文必须是 JSON 对象');
    }

    let title: string | undefined;
    if ('title' in body) {
        if (typeof body.title !== 'string') {
            throw new AppError(400, 'INVALID_TITLE', 'title必须是字符串');
        }
        title = body.title;
    }

    const conversation = await service.newConversation(title);
    res.status(201).json(conversation);
});

app.get('/api/conversations/:id', async (req, res) => {
    // Express 从路径提取并解码 id；服务层继续检查 ID 格式。
    const conversation = await service.getConversation(req.params.id);
    res.json(conversation);
});

app.post('/api/chat', async (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new AppError(400, 'INVALID_BODY', '正文必须是 JSON 对象');
    }
    if (!('conversationId' in body) || typeof body.conversationId !== 'string') {
        throw new AppError(400, 'INVALID_CONVERSATION_ID', 'conversationId必须是字符串');
    }
    if (!('message' in body) || typeof body.message !== 'string') {
        throw new AppError(400, 'INVALID_MESSAGE', 'message必须是字符串');
    }

    // 消息长度、会话读取、并发保护、模型调用和保存都由 service 负责。
    const result = await service.chat(body.conversationId, body.message);
    res.json({ conversationId: result.conversationId, reply: result.reply });
});

// 正常路由已发送响应；走到这里说明路径匹配，但方法不支持。
function methodNotAllowed(allowed: string): RequestHandler {
    return (req, res) => {
        res.set('Allow', allowed);
        throw new AppError(405, 'METHOD_NOT_ALLOWED', `此接口需要 ${allowed} 请求`);
    };
}

// Express 的 GET 路由也默认处理 HEAD，所以 Allow 同时列出 HEAD。
app.all('/health', methodNotAllowed('GET, HEAD'));
app.all('/api/info', methodNotAllowed('GET, HEAD'));
app.all('/api/echo', methodNotAllowed('POST'));
app.all('/api/conversations', methodNotAllowed('POST'));
app.all('/api/conversations/:id', methodNotAllowed('GET, HEAD'));
app.all('/api/chat', methodNotAllowed('POST'));

app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

// TODO：第三步，在这里注册四参数错误处理中间件。
// 将 AppError 转成统一 JSON；随后补充 JSON 解析失败和正文超限的错误映射。
// 当前抛出的异常会由 Express 默认错误处理器响应，尚不是统一 JSON 格式。

app.listen(3001, '127.0.0.1', () => {console.log('Express 服务： http://127.0.0.1:3001');});
