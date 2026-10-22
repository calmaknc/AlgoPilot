import type { FunctionTool } from 'openai/resources/responses/responses';

/** 每个工具同时携带模型可见的描述和本地执行函数；执行函数负责参数校验。 */
export type RegisteredTool = {
    definition: FunctionTool;
    execute: (args: unknown, signal?: AbortSignal) => Record<string, unknown> | Promise<Record<string, unknown>>;
};

/** 从同一份注册列表生成 API 描述和执行入口，避免两边漏注册或名称冲突。 */
export function createToolRegistry(tools: RegisteredTool[]) {
    const registry = new Map<string, RegisteredTool>();
    for (const tool of tools) {
        const name = tool.definition.name;
        if (registry.has(name)) {
            throw new Error(`工具名重复：${name}`);
        }
        registry.set(name, tool);
    }

    /** 仅执行已注册工具，统一解析 JSON、等待结果、封装成功和失败响应。 */
    async function executeTool(name: string, argumentsJson: string, signal?: AbortSignal): Promise<string> {
        try {
            signal?.throwIfAborted();
            const tool = registry.get(name);
            if (!tool) {
                throw new Error(`未知工具：${name}`);
            }

            const args: unknown = JSON.parse(argumentsJson);
            const result = await tool.execute(args, signal);
            signal?.throwIfAborted();
            return JSON.stringify({ ...result, ok: true });
        } catch (error) {
            signal?.throwIfAborted();
            return JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : '工具执行失败'
            });
        }
    }

    return {
        toolDefinitions: tools.map((tool) => tool.definition),
        executeTool
    };
}
