import { createExpressApp } from './express-app.ts';

const app = createExpressApp();
const server = app.listen(3001, '127.0.0.1', () => {
    console.log('Express 服务：http://127.0.0.1:3001');
});
server.on('error', (error) => {
    console.error('服务启动失败：', error.message);
    process.exitCode = 1;
});
