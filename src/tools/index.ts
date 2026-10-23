import { createToolRegistry } from './registry.ts';
import { createWebSearchTool, createReadWebpageTool, createDeletePracticeNoteTool, createExportPracticeNoteTool, createTimeTool, createPythonTool, createSavePracticeNoteTool, createGetPracticeNoteTool, createUpdatePracticeNoteTool, createSearchPracticeNotesTool } from './implementations.ts';

// 唯一注册清单：新增工具时导入工厂并在这里加入一项。
// 各工具统一返回 RegisteredTool，注册层不包含具体业务实现。
const registeredTools = [
    createTimeTool(),
    createWebSearchTool(),
    createReadWebpageTool(),
    createPythonTool(),
    createSavePracticeNoteTool(),
    createSearchPracticeNotesTool(),
    createGetPracticeNoteTool(),
    createUpdatePracticeNoteTool(),
    createDeletePracticeNoteTool(),
    createExportPracticeNoteTool(),
];

export const { toolDefinitions, executeTool } = createToolRegistry(registeredTools);
