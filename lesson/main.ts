import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
    addMessage,
    formatMessages,
} from './messages.ts'
import { requestModel } from './model.ts';
import type { Message } from './messages.ts'
import { saveConversation, loadConversation, loadLastConversation, createConversation } from './session.ts';
import type {Conversation} from './session.ts'

async function agentLoop(messages: Message[], input: string): Promise<void> {
    const userMessage: Message = {
        role: 'user',
        content: input
    };

    stdout.write('助手：');

    let reply: string;
    try {
        reply = await requestModel(
            [...messages, userMessage],
            (text) => {
                stdout.write(text);
            },
            (name, argumentsJson, output) => {
                stdout.write(`\n[工具] ${name} 参数：${argumentsJson}\n`);
                stdout.write(`[结果] ${output}\n助手：`);
            }
        );
    } finally {
        // 正常结束或中途报错后都换行，避免后续提示紧贴回复。
        stdout.write('\n\n');
    }

    addMessage(messages, 'user', input);
    addMessage(messages, 'assistant', reply);

}

async function main(): Promise<void> {
    const requestedId = process.argv[2];
    let conversation: Conversation = requestedId
        ? await loadConversation(requestedId)
        : await loadLastConversation();
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
                // 如果之前保存失败，退出时再尝试保存内存中的记录。
                await saveConversation(conversation);
                break;
            }

            if (input.length === 0) {
                continue;
            }

            if (input === '/history') {
                console.log(formatMessages(conversation.messages).join('\n'));
                continue;
            }

            if (input === '/new') {
                try {
                    await saveConversation(conversation);
                    const next = createConversation();
                    await saveConversation(next);
                    conversation = next;
                    console.log(`已创建会话：${conversation.id}`);
                } catch (error) {
                    console.error('切换会话失败，仍保留当前会话：', error);
                }
                continue;
            }

            try {
                await agentLoop(conversation.messages, input);
                if (conversation.title === '新会话') {
                    conversation.title = input.slice(0, 30);
                }
                try {
                    await saveConversation(conversation);
                } catch (error) {
                    console.error('回答已保留在内存，但保存到磁盘失败：', error);
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
