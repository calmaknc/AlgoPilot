// import {createServer} from 'node:http';
// import type { IncomingMessage } from 'node:http';

// async function readJsonBody(req: IncomingMessage) : Promise<unknown> {
//     req.setEncoding('utf8');

//     let body = '';
//     for await (const chunk of req) {
//         body += chunk;
//     }
    
//     return JSON.parse(body);
// }

// const server = createServer(async (req, res) => {
//     console.log('收到请求: ', req.method, req.url);

//     if (req.method === 'GET' && req.url == '/health') {
//         res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
//         res.end(JSON.stringify({status: 'ok'}));
//         return
//     }

//     if (req.method === 'GET' && req.url == '/api/info') {
//         res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
//         res.end(JSON.stringify({name: 'mini-fastgpt', version: '0.1.0'}));
//         return
//     }

//     if (req.method === 'POST' && req.url === '/api/echo') {
//         let data: unknown;

//         try {
//             data = await readJsonBody(req);
//         } catch {
//             res.writeHead(400, {
//             'Content-Type': 'application/json; charset=utf-8'
//             });
//             res.end(JSON.stringify({error: '请求正文读取失败或不是有效 JSON'}));
//             return;
//         }

//         if (
//             typeof data !== 'object' ||
//             data === null ||
//             Array.isArray(data) ||
//             !('message' in data) ||
//             typeof data.message !== 'string' ||
//             data.message.trim().length === 0
//         ) {
//             res.writeHead(400, {'Content-Type': 'application/json; charset=utf-8'});
//             res.end(JSON.stringify({error: 'message 必须是非空字符串'}));
//             return;
//         }

//         res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
//         res.end(JSON.stringify({received: data.message.trim()}));
//         return;
//     }

//     res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
//     res.end(JSON.stringify({error: '接口不存在'}));
// });

// server.listen(3000, '127.0.0.1', () => {
//     console.log('服务已启动：http://127.0.0.1:3000');
// })

import { createApiServer } from "./http-server.ts";

const server = createApiServer();

server.on('error', (error) => {console.log('服务器错误：', error.message)});
server.listen(3000, '127.0.0.1', () => {console.log('服务已启动：http://127.0.0.1:3000')})
