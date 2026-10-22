import type { Message } from "../agent/messages.ts";

type ChatResponse = {
    choices?: {
        message?: {
            content?: string | null;
        };
    }[];
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {setTimeout(resolve, ms);});
}

export async function requestModel(messages: Message[]): Promise<string> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL;

    if (!apiKey || !model) {
        throw new Error('请配置 DEEPSEEK_API_KEY 和 DEEPSEEK_MODEL');
    }

    const lastMessage = messages.at(-1);

    if (!lastMessage || lastMessage.content.trim().length === 0) {
        throw new Error('需要提供非空消息');
    }

    const response = await fetch(
        'https://api.deepseek.com/chat/completions',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(
                {
                    model, 
                    messages, 
                    stream: false, 
                    thinking: {type: 'disabled'},
                    max_tokens: 4096
                }
            )
        }
    );

    if (!response.ok) {
        throw new Error(`DeepSeek 请求失败：HTTP ${response.status}`);
    }

    const data = (await response.json()) as ChatResponse;
    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
        throw new Error('DeepSeek 没有返回有效的文本回复');
    }

    return content;
}