import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { createChatService, type ChatService } from '../agent/service.ts';
import { fileURLToPath } from 'node:url';
import { AppError } from '../shared/errors.ts';
import { sandboxService, type SandboxService } from '../sandbox/service.ts';

// 每个应用共用一个 service；测试可以注入模拟模型和临时存储。
export function createExpressApp(
    service: ChatService = createChatService(),
    sandbox: SandboxService = sandboxService,
) {
    const app = express();

    // 只在需要 JSON 的路由解析正文。
    const requireJson: RequestHandler = (req, res, next) => {
        const mediaType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
        if (mediaType !== 'application/json') {
            throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json');
        }
        next();
    };
    const parseJson = express.json({ limit: '64kb', strict: false });
    // 仅提供这两个浏览器库文件，不公开整个 node_modules。
    app.get('/vendor/marked.js', (req, res) => {
        res.sendFile(fileURLToPath(new URL('../../node_modules/marked/lib/marked.umd.js', import.meta.url)));
    });
    app.get('/vendor/purify.js', (req, res) => {
        res.sendFile(fileURLToPath(new URL('../../node_modules/dompurify/dist/purify.min.js', import.meta.url)));
    });
    app.use(express.static(fileURLToPath(new URL('../../public/', import.meta.url))));
    app.get('/health', (req, res) => {res.json({status: 'ok'})});
    app.get('/api/info', (req, res) => {res.json({name: 'mini-fastgpt', version: '0.1.0'})});
    app.post('/api/echo', requireJson, parseJson, (req, res) => {
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

    app.post('/api/conversations', requireJson, parseJson, async (req, res) => {
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

    app.post('/api/chat', requireJson, parseJson, async (req, res) => {
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

    app.post('/api/sandbox/run', requireJson, parseJson, async (req, res) => {
        const result = await sandbox.run(req.body);
        // 程序异常/超时是执行结果；Docker 故障或清理失败才是服务不可用。
        res.status(result.status === 'infrastructure_error' || result.cleanupError ? 503 : 200).json(result);
    });

    // NDJSON：每行一个事件，正文与工具结果里的换行由 JSON.stringify 转义。
    app.post('/api/chat/stream', requireJson, parseJson, async (req, res) => {
        const body: unknown = req.body;
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
            throw new AppError(400, 'INVALID_BODY', '正文必须是 JSON 对象');
        }
        if (!('conversationId' in body) || typeof body.conversationId !== 'string') {
            throw new AppError(400, 'INVALID_CONVERSATION_ID', 'conversationId 必须是字符串');
        }
        if (!('message' in body) || typeof body.message !== 'string') {
            throw new AppError(400, 'INVALID_MESSAGE', 'message 必须是字符串');
        }
        res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
        const send = (event: object) => {
            if (res.destroyed || res.writableEnded) return;
            if (res.writableLength > 1024 * 1024) {
                throw new Error('客户端读取过慢，流缓冲超过限制');
            }
            res.write(JSON.stringify(event) + '\n');
        };
        try {
            const result = await service.chat(body.conversationId, body.message, {
                onChunk: text => send({ type: 'delta', text }),
                onTool: (name, argumentsJson, output) => send({ type: 'tool', name, argumentsJson, output }),
            });
            // chat 返回前已经保存，done 才代表本轮真正完成。
            send({ type: 'done', conversationId: result.conversationId,
                reply: result.reply, title: result.conversation.title });
        } catch (error) {
            const failure = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', '服务器内部错误');
            if (!res.headersSent) throw failure;
            if (!res.destroyed && !res.writableEnded) {
                res.write(JSON.stringify({ type: 'error', code: failure.code, message: failure.message }) + '\n');
            }
        } finally {
            // 抛出到全局错误处理中间件之前不能提前结束未发送的响应。
            if (res.headersSent && !res.destroyed && !res.writableEnded) res.end();
        }
    });

    // 正常路由已发送响应；走到这里说明路径匹配，但方法不支持。
    function methodNotAllowed(allowed: string): RequestHandler {
        return (req, res) => {
            res.set('Allow', allowed);
            throw new AppError(405, 'METHOD_NOT_ALLOWED', `此接口需要 ${allowed} 请求`);
        };
    }

    // Express 的 GET 路由也默认处理 HEAD，所以 Allow 同时列出 HEAD。
    app.all('/health', methodNotAllowed('GET, HEAD')); // 传的是允许的方法
    app.all('/api/info', methodNotAllowed('GET, HEAD'));
    app.all('/api/echo', methodNotAllowed('POST'));
    app.all('/api/conversations', methodNotAllowed('POST'));
    app.all('/api/conversations/:id', methodNotAllowed('GET, HEAD'));
    app.all('/api/chat', methodNotAllowed('POST'));
    app.all('/api/chat/stream', methodNotAllowed('POST'));
    app.all('/api/sandbox/run', methodNotAllowed('POST'));

    app.use((req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
    });

    // 所有路由之后注册统一错误处理。
    const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
        if (res.headersSent) {
            next(error);
            return;
        }
        let failure: AppError;

        if (error instanceof AppError) {
            failure = error;
        } else if (error instanceof URIError) {
            failure = new AppError(400, 'INVALID_PATH', '路径编码不正确');
        } else if (typeof error === 'object' && error !== null && 'type' in error) {
            switch (error.type) {
                case 'entity.parse.failed':
                    failure = new AppError(400, 'INVALID_JSON', '请求正文不是有效 JSON');
                    break;
                case 'entity.too.large':
                    failure = new AppError(413, 'TOO_LONG_BODY_BYTES', '正文超过 64 KiB 限制');
                    break;
                case 'charset.unsupported':
                case 'encoding.unsupported':
                    failure = new AppError(415, 'UNSUPPORTED_ENCODING', '不支持该请求编码');
                    break;
                case 'request.aborted':
                case 'request.size.invalid':
                    failure = new AppError(400, 'INVALID_BODY', '请求正文接收不完整');
                    break;
                default:
                    failure = new AppError(500, 'INTERNAL_ERROR', '服务器内部错误');
            }
        } else {
            failure = new AppError(500, 'INTERNAL_ERROR', '服务器内部错误');
        }

        res.status(failure.status).json(
            {
                error: {
                    code: failure.code,
                    message: failure.message
                },
            }
        );
    };

    app.use(errorHandler);
    return app;
}
