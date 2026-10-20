import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppError } from './errors.ts';
import { createChatService, type ChatService } from './chat-service.ts';

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
    throw new AppError(501, 'NOT_IMPLEMENTED', '请实现 readJsonBody');
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
        if (req.method === 'GET' && path === '/health') {
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
        throw new AppError(404, 'NOT_FOUND', '接口不存在或尚未实现');
    }

    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    return server;
}

// TODO 7：上面的路由通过验证后，再让 server.ts 导入 createApiServer 并监听端口。
// 当前 server.ts 和 main.ts 仍保留你此前的可运行实现。
