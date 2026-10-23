export type Role = Message['role'];

export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type ModelCallRecord = { round: number; durationMs: number; usage: TokenUsage | null };
export type TurnMetrics = { durationMs: number; modelCalls: ModelCallRecord[]; usage: TokenUsage | null };

/** 保存结果状态而非完整输出；不作为模型协议消息发送。可选字段兼容旧会话。 */
export type ToolCallRecord = {
    name: string;
    argumentsJson: string;
    /** 工具执行前已输出的正文字符数，用于还原文字与工具的顺序。 */
    textOffset?: number;
    callId?: string;
    round?: number;
    durationMs?: number;
    status?: 'success' | 'error';
    resultStatus?: string;
};

export type UserMessage = {
    role: 'user';
    content: string;
    toolCalls?: never;
    metrics?: never;
};

export type AssistantMessage = {
    role: 'assistant';
    content: string;
    toolCalls?: ToolCallRecord[];
    metrics?: TurnMetrics;
};

export type SystemMessage = {
    role: 'system';
    content: string;
    toolCalls?: never;
    metrics?: never;
};

/** role 是判别字段，缩小类型后才能给助手附加工具和统计。 */
export type Message = UserMessage | AssistantMessage | SystemMessage;

export function addMessage(messages: Message[], role: Role, content: string): void {
    const trimmed = content.trim();

    if (trimmed.length === 0) {
        throw new Error("消息不能为空");
    }

    messages.push({role, content: trimmed});
}

export function getRecentMessages(messages: Message[], limit: number): Message[] {
    if (!Number.isInteger(limit) || limit < 0) {
        throw new Error("limit 非负整数");
    }

    if (limit === 0) {
        return [];
    }

    return messages.slice(-limit);
}

export function getMessagesByRole<R extends Role>(messages: Message[], role: R): Extract<Message, { role: R }>[] {
    return messages.filter((message): message is Extract<Message, { role: R }> => message.role === role);
}

export function formatMessages(messages: Message[]): string[] {
    return messages.map((x) => `${x.role}: ${x.content}`)
}
