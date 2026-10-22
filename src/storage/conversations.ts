import type { Message } from '../agent/messages.ts';
import { mkdir, writeFile, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export type Conversation = {
    id: string;
    title: string;
    messages: Message[];
};

const dataDirectory = new URL('../../data/conversations/', import.meta.url);

export function createConversation(id: string = randomUUID()): Conversation {
    return { id, title: '新会话', messages: [] };
}

/** 会话 ID 用作文件名，只接受简单标识符，防止路径跳出 data 目录。 */
function conversationFile(id: string, directory: URL): URL {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        throw new Error('会话 ID 只能包含字母、数字、下划线和短横线，长度为 1～128');
    }
    return new URL(`conversation_${id}.json`, directory);
}

function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** JSON.parse 不会验证类型；检查文件结构后才能作为 Conversation 使用。 */
function validateConversation(value: unknown, expectedId: string): asserts value is Conversation {
    if (
        typeof value !== 'object' || value === null ||
        !('id' in value) || value.id !== expectedId ||
        !('title' in value) || typeof value.title !== 'string' ||
        !('messages' in value) || !Array.isArray(value.messages) ||
        !value.messages.every((message: unknown) =>
            typeof message === 'object' && message !== null &&
            'role' in message &&
            (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
            'content' in message && typeof message.content === 'string'
        )
    ) {
        throw new Error('会话文件结构不正确');
    }
}

/** 指定会话不存在时继续抛出错误，避免错误 ID 或损坏文件被当作空历史覆盖。 */
export async function loadConversation(id: string, directory = dataDirectory): Promise<Conversation> {
    const raw = await readFile(conversationFile(id, directory), 'utf8');
    const value: unknown = JSON.parse(raw);
    validateConversation(value, id);
    return value;
}

/** 首次启动没有最近会话记录时创建新会话，其他读取和解析错误继续上抛。 */
export async function loadLastConversation(directory = dataDirectory): Promise<Conversation> {
    let id: string;
    try {
        id = (await readFile(new URL('last-session.txt', directory), 'utf8')).trim();
    } catch (error) {
        if (isMissingFile(error)) return createConversation();
        throw error;
    }
    return loadConversation(id, directory);
}

/** 先写临时文件再替换，避免直接覆盖旧文件时留下半段 JSON。 */
async function replaceFile(file: URL, content: string): Promise<void> {
    const temporary = new URL(`${file.href}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, content, 'utf8');
        await rename(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
}

/** 保存完整会话，再记录最近会话 ID；失败由调用方处理，不能假装保存成功。 */
export async function saveConversation(conversation: Conversation, directory = dataDirectory): Promise<void> {
    const file = conversationFile(conversation.id, directory);
    validateConversation(conversation, conversation.id);
    await mkdir(directory, { recursive: true });
    await replaceFile(file, JSON.stringify(conversation, null, 2));
    await replaceFile(new URL('last-session.txt', directory), conversation.id);
}
