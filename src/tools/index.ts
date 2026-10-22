import { createToolRegistry } from './registry.ts';
import { createTimeTool, createSearchNotesTool, createPythonTool } from './implementations.ts';

// 唯一注册清单：新增工具时导入工厂并在这里加入一项。
// 各工具统一返回 RegisteredTool，注册层不包含具体业务实现。
const registeredTools = [
    createTimeTool(),
    createSearchNotesTool(),
    createPythonTool(),
];

export const { toolDefinitions, executeTool } = createToolRegistry(registeredTools);
