import { requestModel } from "./model-http.ts";

async function main(): Promise<void> {
    console.log('A: 准备请求');

    const pending = requestModel([{ role: 'user', content: '什么是Agent' }]);

    console.log('B: 以发送请求');

    const reply = await pending;

    console.log('C: 拿到回复', reply);
}

main().catch((error: unknown) => {console.error('请求失败： ', error);});
