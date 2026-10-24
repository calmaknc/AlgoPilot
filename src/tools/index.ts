import { createToolRegistry } from './registry.ts';
import { createWebSearchTool, createReadWebpageTool, createDeletePracticeNoteTool, createExportPracticeNoteTool, createTimeTool, createPythonTool, createSavePracticeNoteTool, createGetPracticeNoteTool, createUpdatePracticeNoteTool, createSearchPracticeNotesTool } from './implementations.ts';

// 唯一注册清单：新增工具时导入工厂并在这里加入一项。
// 各工具统一返回 RegisteredTool，注册层不包含具体业务实现。
export function createAgentTools(options: { notesDirectory?: URL; exportsDirectory?: URL } = {}) {
    const registeredTools = [
        createTimeTool(),
        createWebSearchTool(),
        createReadWebpageTool(),
        createPythonTool(),
        createSavePracticeNoteTool(options.notesDirectory),
        createSearchPracticeNotesTool(options.notesDirectory),
        createGetPracticeNoteTool(options.notesDirectory),
        createUpdatePracticeNoteTool(options.notesDirectory),
        createDeletePracticeNoteTool(options.notesDirectory),
        createExportPracticeNoteTool(options.notesDirectory, options.exportsDirectory),
    ];
    return createToolRegistry(registeredTools);
}

export const { toolDefinitions, executeTool } = createAgentTools();
