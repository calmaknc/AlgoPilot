// 由 typecheck 验证角色收窄与字段限制，不执行运行时逻辑。
import { getMessagesByRole, type Message, type UserMessage, type AssistantMessage } from '../src/agent/messages.ts';

const user: UserMessage = { role: 'user', content: '运行代码' };
const assistant: AssistantMessage = { role: 'assistant', content: '执行结果', toolCalls: [] };
const messages: Message[] = [user, assistant];
const assistants: AssistantMessage[] = getMessagesByRole(messages, 'assistant');
void assistants;
// @ts-expect-error 用户消息不能包含工具调用。
const invalidUser: UserMessage = { role: 'user', content: 'x', toolCalls: [] };
// @ts-expect-error 用户消息不能包含模型统计。
const invalidMetrics: UserMessage = { role: 'user', content: 'x', metrics: { durationMs: 0, modelCalls: [], usage: null } };
// @ts-expect-error 助手类型不能使用 user 角色。
const invalidRole: AssistantMessage = { role: 'user', content: 'x' };
void [invalidUser, invalidMetrics, invalidRole];
