import type { UserMessage, AssistantMessage, Message, ToolCallRecord, ModelCallRecord, TokenUsage, TurnMetrics } from './messages.ts';
import type { Conversation } from '../storage/conversations.ts';
import { createConversation, loadConversation, initializeConversation, appendMessages, updateConversationTitle, setLastConversation } from '../storage/conversations.ts';
import { AppError } from '../shared/errors.ts';
import type { MemoryEvent } from './memory.ts';
import { ContextLimitError } from './context-compression.ts';

export type AgentCallbacks = {
    signal?: AbortSignal;
    onChunk?: (text: string) => void;
    onTool?: (name: string, argumentsJson: string, output: string, record?: ToolCallRecord) => void;
    onModelCall?: (record: ModelCallRecord) => void;
    onMemory?: (event: MemoryEvent) => void;
};

export type ModelRunner = (
    messages: Message[],
    onChunk?: AgentCallbacks['onChunk'],
    onTool?: AgentCallbacks['onTool'],
    signal?: AbortSignal,
    onModelCall?: AgentCallbacks['onModelCall'],
    onMemory?: AgentCallbacks['onMemory']
) => Promise<string>;

export type AgentResult = {
    conversationId: string;
    reply: string;
    conversation: Conversation;
    memoryEvents: MemoryEvent[];
};

/** 工厂函数：把依赖和共享状态放在一个地方，终端、HTTP 和测试可复用。 */
export function createAgentService(options: { directory?: URL; runModel?: ModelRunner } = {}) {
    // 测试时可以传入临时目录和模拟模型，避免修改真实历史或支付 API 费用。
    const directory = options.directory;
    const runModel: ModelRunner = options.runModel ?? (async (messages, onChunk, onTool, signal, onModelCall, onMemory) => {
        const { requestModel } = await import('./runner.ts');
        return requestModel(messages, onChunk, onTool, signal, onModelCall, undefined, { onMemory });
    });

    const busy = new Set<string>();

    async function newConversation(title = '新会话'): Promise<Conversation> {
        if (typeof title !== 'string' || title.trim().length <= 0 || title.trim().length > 100) {
            throw new AppError(400, 'INVALID_TITLE', 'title必须是1～100个字符的字符串')
        }

        const conversation = createConversation();
        conversation.title = title.trim();
        await initializeConversation(conversation, directory);
        return conversation;
    }

    async function getConversation(id: string): Promise<Conversation> {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
            throw new AppError(400, 'INVALID_CONVERSATION_ID', '会话 ID 只能包含字母、数字、下划线和短横线，长度为 1～128');
        }
        try {
            const conversation = await loadConversation(id, directory);
            return conversation;
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                throw new AppError(404, 'CONVERSATION_NOT_FOUND', '会话不存在');
            } else {
                throw new AppError(500, 'STORAGE_ERROR', '无法读取会话，请检查存储文件')
            }
        }
        
    }

    async function run(
        conversationId: string,
        message: string,
        callbacks: AgentCallbacks = {}
    ): Promise<AgentResult> {
        if (typeof message !== 'string' || message.trim().length < 1 || message.trim().length > 10000) {
            throw new AppError(400, 'INVALID_MESSAGE', 'message必须是长度为1～10000的字符串');
        }

        callbacks.signal?.throwIfAborted();
        if (busy.has(conversationId)) {
            throw new AppError(409, 'CONVERSATION_BUSY', '当前会话正忙');
        }
        busy.add(conversationId);
        try {
            const trimmedMessage = message.trim();
            const conversation = await getConversation(conversationId);
            const userMessage: UserMessage = {
                role: 'user',
                content: trimmedMessage,
            };
            // 持久化元数据不传入模型，避免不完整的工具调用协议和额外字段。
            const input = [...conversation.messages, userMessage].map(({ role, content }) => ({ role, content }));
            const toolCalls: ToolCallRecord[] = [];
            const modelCalls: ModelCallRecord[] = [];
            const memoryEvents: MemoryEvent[] = [];
            const started = performance.now();
            let streamedText = '';

            let reply: string;

            try {
                reply = await runModel(input, text => {
                    streamedText += text;
                    callbacks.onChunk?.(text);
                }, (name, argumentsJson, output, record) => {
                    toolCalls.push({ ...(record ?? { name, argumentsJson }), textOffset: streamedText.length });
                    callbacks.onTool?.(name, argumentsJson, output, record);
                }, callbacks.signal, record => {
                    modelCalls.push(record);
                    callbacks.onModelCall?.(record);
                }, event => {
                    memoryEvents.push(event);
                    callbacks.onMemory?.(event);
                });

                if (typeof reply !== 'string' || reply.trim().length === 0) {
                    throw new Error('模型没有返回有效文本');
                }
            } catch (error) {
                callbacks.signal?.throwIfAborted();
                if (error instanceof ContextLimitError) throw new AppError(502, 'CONTEXT_LIMIT', error.message);
                throw new AppError(502, 'MODEL_ERROR', '模型调用失败，本轮未保存');
            }
            // 保存开始前是取消边界；开始写盘后必须等待写入完成。
            callbacks.signal?.throwIfAborted();
            // 缺失任何请求的 usage 时，总量未知，不能把部分统计冒充总量。
            const usage: TokenUsage | null = modelCalls.length && modelCalls.every(call => call.usage !== null)
                ? modelCalls.reduce((sum, call) => ({
                    inputTokens: sum.inputTokens + call.usage!.inputTokens,
                    outputTokens: sum.outputTokens + call.usage!.outputTokens,
                    totalTokens: sum.totalTokens + call.usage!.totalTokens,
                }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) : null;
            const metrics: TurnMetrics = { durationMs: Math.round(performance.now() - started), modelCalls, usage };
            const assistantMessage: AssistantMessage = {
                role: 'assistant', content: reply, metrics, ...(toolCalls.length ? { toolCalls } : {})
            };
            conversation.messages.push(userMessage, assistantMessage);
            const updateTitle = conversation.title === '新会话';
            if (updateTitle) {
                conversation.title = trimmedMessage.slice(0, 30);
            }

            try {
                await appendMessages(conversationId, [userMessage, assistantMessage], directory);
                if (updateTitle) await updateConversationTitle(conversationId, conversation.title, directory);
                await setLastConversation(conversationId, directory);
            } catch {
                throw new AppError(500, 'STORAGE_ERROR', '会话保存失败，请读取历史核对保存状态');
            }

            return {conversationId, reply, conversation, memoryEvents};
        } finally {
            busy.delete(conversationId);
        }
        
    }

    return { newConversation, getConversation, run };
}

export type AgentService = ReturnType<typeof createAgentService>;
