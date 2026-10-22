import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppError } from '../shared/errors.ts';
import { createChatService, type ChatService } from '../agent/service.ts';

export const MAX_BODY_BYTES = 64 * 1024;

// 基础设施已提供：各路由统一用这个函数返回 JSON。
function sendJson(res: ServerResponse, status: number, data: unknown): void {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    // TODO 5：从你在 server.ts 中的实现迁移过来，再补充限制。
    // - 接受 application/json（可以带 charset），否则抛 415。
    // - 限制实际收到的字节数为 MAX_BODY_BYTES，超出抛 413。
    // - JSON 解析失败抛 400，返回类型为 unknown。
    // - 不只信任 Content-Length，也不要用字符串 length 代替字节数。
    const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
    if (contentType !== 'application/json') {
        throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用application/json')
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req.iterator({destroyOnReturn: false})) {
        if (totalBytes + Buffer.byteLength(chunk, 'utf-8') > MAX_BODY_BYTES) {
            req.resume();
            throw new AppError(413, 'TOO_LONG_BODY_BYTES', 'BODY超过最大限制');
        }
        totalBytes += Buffer.byteLength(chunk, 'utf-8');
        chunks.push(chunk);
    }

    const text = Buffer.concat(chunks).toString('utf-8');
    try {
        return JSON.parse(text);
    } catch {
        throw new AppError(400, 'INVALID_JSON', '请求正文不是有效 JSON');
    }
}

/** 仅构造服务，不监听端口，方便测试在随机端口启动。 */
export function createApiServer(service: ChatService = createChatService()) {
    const server = createServer((req, res) => {
        void handle(req, res).catch((error: unknown) => {
            const failure = error instanceof AppError
                ? error
                : new AppError(500, 'INTERNAL_ERROR', '服务器内部错误');
            sendJson(res, failure.status, {
                error: { code: failure.code, message: failure.message }
            });
        });
    });

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const path = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (path === '/health') {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                throw new AppError(405, 'METHOD_NOT_ALLOWED', '此接口需要GET请求');
            }
            sendJson(res, 200, { status: 'ok' });
            return;
        }

        // TODO 6：依次实现下列路由，完成一个就用 curl 验证一个。
        // POST /api/conversations
        //   正文：{} 或 { title: string }
        //   调用 service.newConversation()，返回 201 和会话对象。
        //
        // GET /api/conversations/:id
        //   提取并解码 id，调用 service.getConversation()，返回 200。
        //
        // POST /api/chat
        //   正文：{ conversationId: string, message: string }
        //   校验解析结果后调用 service.chat()。
        //   返回 200 和 { conversationId, reply }，这一阶段先不转发流。
        //
        // 同时迁移已有 /api/info 和 /api/echo，保留原有练习能力。
        // 已知路径使用错误方法时返回 405，未知路径返回 404。
        if (path === '/api/conversations') {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                throw new AppError(405, 'METHOD_NOT_ALLOWED', '此接口需要post请求');
            }
            const body = await readJsonBody(req);
            if (typeof body !== 'object' || body === null || Array.isArray(body)) {
                throw new AppError(400, 'INVALID_BODY', '正文必须是JSON对象');
            }
            let title: string | undefined; 

            if ('title' in body) {
                if (typeof body.title !== 'string') {
                    throw new AppError(400, 'INVALID_TITLE', '对话的title不合法');
                }
                title = body.title;
            }
            
            const conversation = await service.newConversation(title);
            sendJson(res, 201, conversation);
            return;
        }
        
        const match = /^\/api\/conversations\/([^/]+)$/.exec(path);
        if (match) {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                throw new AppError(405, 'METHOD_NOT_ALLOWED', '此接口需要get请求');
            }

            let id: string;

            try {
                id = decodeURIComponent(match[1]!);
            } catch {
                throw new AppError(400, 'INVALID_CONVERSATION_ID', '会话ID编码不正确');
            }

            const conversation = await service.getConversation(id);
            sendJson(res, 200, conversation);
            return;
        }

        if (path === '/api/chat') {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                throw new AppError(405, 'METHOD_NOT_ALLOWED', '此接口需要post请求');
            }
            
            // 检查body
            const body = await readJsonBody(req);
            if (typeof body !== 'object' || body === null || Array.isArray(body)) {
                throw new AppError(400, 'INVALID_BODY', '正文必须是JSON对象');
            }

            // 检查conversationId字段和message字段
            if (!('conversationId' in body) || typeof body.conversationId !== 'string') {
                throw new AppError(400, 'INVALID_CONVERSATION_ID', 'conversationId必须是字符串');
            }
            if (!('message' in body) || typeof body.message !== 'string') {
                throw new AppError(400, 'INVALID_MESSAGE', 'message必须是字符串');
            }

            const result = await service.chat(body.conversationId, body.message);
            sendJson(res, 200, {conversationId: result.conversationId, reply: result.reply});
            return;
        }

        if (path === '/api/info') {
            if (req.method !== 'GET') {
                res.setHeader('Allow', 'GET');
                throw new AppError(405, 'METHOD_NOT_ALLOWED', '此接口需要GET请求');
            }
            sendJson(res, 200, {name: 'mini-fastgpt', version: '0.1.0'});
            return;
        }

        if (path === '/api/echo') {
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST');
                throw new AppError(405, 'METHOD_NOT_ALLOWED', '此接口需要POST请求');
            }
            let body: unknown;
            body = await readJsonBody(req);

            if ( typeof body !== 'object' || body === null || Array.isArray(body) ) {
                throw new AppError(400, 'INVALID_BODY', '正文必须是JSON对象');
            }

            if (!('message' in body) || typeof body.message !== 'string') {
                throw new AppError(400, 'INVALID_MESSAGE', 'message必须是字符串');
            }

            if (body.message.trim().length < 1 || body.message.trim().length > 10000) {
                throw new AppError(400, 'INVALID_MESSAGE', 'message必须是长度为1～10000的字符串');
            }

            sendJson(res, 200, {received: body.message.trim()});
            return;
        }
        throw new AppError(404, 'NOT_FOUND', '接口不存在');
    }

    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    return server;
}

// server.ts 负责监听端口；main.ts 与 HTTP 路由共用聊天服务。
