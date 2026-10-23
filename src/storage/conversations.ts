import type { Message } from '../agent/messages.ts';
import { mkdir, writeFile, readFile, rename, rm, appendFile } from 'node:fs/promises';
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
function conversationFile(id: string, directory: URL, format: 'jsonl' | 'meta.json' = 'jsonl'): URL {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        throw new Error('会话 ID 只能包含字母、数字、下划线和短横线，长度为 1～128');
    }
    return new URL(`conversation-${id}.${format}`, directory);
}

function isMissingFile(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isDuration = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validUsage(value: unknown): boolean {
    return value === null || (isRecord(value) && isCount(value.inputTokens) && isCount(value.outputTokens) && isCount(value.totalTokens));
}
function validMetrics(value: unknown): boolean {
    return isRecord(value) && isDuration(value.durationMs) && validUsage(value.usage) &&
        Array.isArray(value.modelCalls) && value.modelCalls.every(call =>
            isRecord(call) && isCount(call.round) && call.round > 0 && isDuration(call.durationMs) && validUsage(call.usage));
}
function validToolCall(call: unknown): boolean {
    return isRecord(call) && typeof call.name === 'string' && call.name.length > 0 &&
        typeof call.argumentsJson === 'string' &&
        (!('textOffset' in call) || isCount(call.textOffset)) &&
        (!('callId' in call) || (typeof call.callId === 'string' && call.callId.length > 0)) &&
        (!('round' in call) || (isCount(call.round) && call.round > 0)) &&
        (!('durationMs' in call) || isDuration(call.durationMs)) &&
        (!('status' in call) || call.status === 'success' || call.status === 'error') &&
        (!('resultStatus' in call) || typeof call.resultStatus === 'string') &&
        Object.keys(call).every(key => ['name', 'argumentsJson', 'textOffset', 'callId', 'round', 'durationMs', 'status', 'resultStatus'].includes(key));
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
            'content' in message && typeof message.content === 'string' &&
            (!('toolCalls' in message) || (
                message.role === 'assistant' && Array.isArray(message.toolCalls) &&
                message.toolCalls.every(validToolCall)
            )) &&
            (!('metrics' in message) || (message.role === 'assistant' && validMetrics(message.metrics)))
        )
    ) {
        throw new Error('会话文件结构不正确');
    }
}

type ConversationMeta = { version: 1; id: string; title: string };

async function loadMeta(id: string, directory: URL): Promise<ConversationMeta> {
    const value: unknown = JSON.parse(await readFile(conversationFile(id, directory, 'meta.json'), 'utf8'));
    if (!isRecord(value) || value.version !== 1 || value.id !== id || typeof value.title !== 'string') {
        throw new Error('会话文件结构不正确：元信息无效');
    }
    return value as ConversationMeta;
}

/** 消息文件只有消息行；空文件代表新会话，截断记录不得继续追加。 */
function parseMessages(raw: string): unknown[] {
    if (!raw) return [];
    if (!raw.endsWith('\n')) throw new SyntaxError('会话 JSONL 末尾记录不完整，请检查文件');
    return raw.slice(0, -1).split('\n').map((line, index) => {
        try { return JSON.parse(line); }
        catch { throw new SyntaxError(`会话 JSONL 第 ${index + 1} 行不是有效 JSON`); }
    });
}

export async function loadConversation(id: string, directory = dataDirectory): Promise<Conversation> {
    const meta = await loadMeta(id, directory);
    const messages = parseMessages(await readFile(conversationFile(id, directory), 'utf8'));
    const conversation = { id: meta.id, title: meta.title, messages };
    validateConversation(conversation, id);
    return conversation;
}

/** 无最近会话或指向未迁移旧会话时返回 null；新格式文件损坏仍报错。 */
export async function loadLastConversation(directory = dataDirectory): Promise<Conversation | null> {
    let id: string;
    try {
        id = (await readFile(new URL('last-session.txt', directory), 'utf8')).trim();
    } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
    }
    try { await loadMeta(id, directory); }
    catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
    }
    return loadConversation(id, directory);
}

/** 元信息与最近会话指针较小，仍用原子替换；消息文件不走此路径。 */
async function replaceFile(file: URL, content: string): Promise<void> {
    const temporary = new URL(`${file.href}.${randomUUID()}.tmp`);
    try {
        await writeFile(temporary, content, 'utf8');
        await rename(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
}

export async function setLastConversation(id: string, directory = dataDirectory): Promise<void> {
    await loadMeta(id, directory);
    await replaceFile(new URL('last-session.txt', directory), id);
}

/** 仅初始化空会话，排他创建，绝不覆盖已有消息。 */
export async function initializeConversation(conversation: Conversation, directory = dataDirectory): Promise<void> {
    const file = conversationFile(conversation.id, directory);
    validateConversation(conversation, conversation.id);
    if (conversation.messages.length) throw new Error('初始化会话必须为空，请使用 appendMessages 追加消息');
    await mkdir(directory, { recursive: true });
    // wx 防止意外截断同名旧文件；元信息最后发布。
    await writeFile(file, '', { flag: 'wx' });
    const meta: ConversationMeta = { version: 1, id: conversation.id, title: conversation.title };
    await writeFile(conversationFile(conversation.id, directory, 'meta.json'), JSON.stringify(meta, null, 2), { flag: 'wx' });
    await setLastConversation(conversation.id, directory);
}

/** 只接收本次新增消息；不会将完整历史重复写入文件。 */
export async function appendMessages(id: string, messages: Message[], directory = dataDirectory): Promise<void> {
    validateConversation({ id, title: '', messages }, id);
    if (!messages.length) return;
    // 拒绝在损坏或截断的历史后继续追加；不自动丢弃或修复已有数据。
    await loadConversation(id, directory);
    const lines = messages.map(message => JSON.stringify(message)).join('\n') + '\n';
    await appendFile(conversationFile(id, directory), lines, { encoding: 'utf8', flag: 'a' });
}

export async function updateConversationTitle(id: string, title: string, directory = dataDirectory): Promise<void> {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) {
        throw new Error('title 必须是 1～100 个字符的字符串');
    }
    const meta = await loadMeta(id, directory);
    await replaceFile(conversationFile(id, directory, 'meta.json'), JSON.stringify({ ...meta, title: title.trim() }, null, 2));
}
