import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { formatMessages } from './messages.ts'
import { saveConversation, loadLastConversation } from './session.ts';
import type {Conversation} from './session.ts'
import { createChatService } from './chat-service.ts';

async function main(): Promise<void> {
    const service = createChatService();
    const requestedId = process.argv[2];
    let conversation: Conversation = requestedId ? await service.getConversation(requestedId): await loadLastConversation();
    await saveConversation(conversation);

    const terminal = createInterface({
        input: stdin,
        output: stdout
    });

    console.log(`当前会话：${conversation.id}，已加载 ${conversation.messages.length} 条消息。`);
    console.log('输入问题开始聊天，/history 查看历史，/new 新建会话，/exit 退出。');

    try {
        while (true) {
            const input = (await terminal.question('你： ')).trim();

            if (input === '/exit') {
                break;
            }

            if (input.length === 0) {
                continue;
            }

            if (input === '/history') {
                try {
                    conversation = await service.getConversation(conversation.id);
                    console.log(formatMessages(conversation.messages).join('\n'));
                } catch {
                    console.log('读取失败');
                }
                continue;
            }

            if (input === '/new') {
                try {
                    conversation = await service.newConversation();
                    console.log(`已创建会话：${conversation.id}`);
                } catch (error) {
                    console.error('切换会话失败，仍保留当前会话：', error);
                }
                continue;
            }

            try {
                stdout.write('助手： ');
                try {
                    const result = await service.chat(
                        conversation.id,
                        input,
                        {
                            onChunk: (text) => {stdout.write(text);},
                            onTool: (name, argumentsJson, output) => {
                                stdout.write(`\n[工具] ${name} 参数： ${argumentsJson}\n`);
                                stdout.write(`[结果] ${output}\n助手： `);
                            }
                        }
                    );
                    conversation = result.conversation;
                } finally {
                    stdout.write('\n\n');
                }
            } catch (error) {
                if (error instanceof Error) {
                    console.error('本轮失败： ', error.message);
                } else {
                    console.error('本轮失败： ', error);
                }
            }
        }
    } finally {
        terminal.close();
    }
    console.log('聊天结束。');
}

main().catch((error: unknown) => {
    console.error('程序异常：', error);
    process.exitCode = 1;
});
