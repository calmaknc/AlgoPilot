export type Role = 'user' | 'assistant' | 'system';

export type Message = {
    role: Role;
    content: string;
};

// const messages: Message[] = [];

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

export function getMessagesByRole(messages: Message[], role: Role): Message[] {
    // 传lambda函数进去
    return messages.filter((x) => x.role === role);
}

export function formatMessages(messages: Message[]): string[] {
    return messages.map((x) => `${x.role}: ${x.content}`)
}