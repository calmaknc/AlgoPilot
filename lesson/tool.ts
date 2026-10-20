import type { FunctionTool } from 'openai/resources/responses/responses';
import { readdir, readFile } from 'node:fs/promises';
import { createToolRegistry, type RegisteredTool } from './tool-registry.ts';

const notesDirectory = new URL('../notes/', import.meta.url);

// 发给模型的是工具描述，真正的函数代码留在本地执行。
export const timeTool: FunctionTool = {
    type: 'function',
    name: 'get_current_time',
    description: '查询指定 IANA 时区的当前日期和时间。用户询问当前时间时使用。',
    parameters: {
        type: 'object',
        properties: {
            timezone: {
                type: 'string',
                description: 'IANA 时区，例如 Asia/Shanghai 或 Europe/London'
            }
        },
        required: ['timezone'],
        additionalProperties: false
    },
    strict: false
};

export const searchNotesTool: FunctionTool = {
    type: 'function',
    name: 'search_notes',
    description: '搜索本地学习笔记，返回文件名、章节标题和原文片段。query 使用简短关键词或术语，如“联合类型”“Promise”，不要传完整问题。',
    parameters: {
        type: 'object',
        properties: {
            query: { type: 'string', description: '用于字面匹配的非空关键词，英文忽略大小写' }
        },
        required: ['query'],
        additionalProperties: false
    },
    strict: false
};

/** 读取本机时钟，按指定时区格式化；无效时区由 Intl 抛出错误。 */
export function getCurrentTime(timezone: string): string {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).format(new Date());
}

type NoteMatch = {
    file: string;
    heading: string;
    text: string;
};

type SearchNotesResult = {
    query: string;
    matches: NoteMatch[];
};

/** 按二级标题搜索当前笔记，忽略英文大小写，最多返回 5 节原文。 */
export async function searchNotes(query: string): Promise<SearchNotesResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
        throw new Error('关键词不能为空');
    }
    const keyword = normalizedQuery.toLowerCase();
    const maxMatches = 5;
    const entries = await readdir(notesDirectory, {withFileTypes: true});

    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();

    const result: SearchNotesResult = {query: normalizedQuery, matches: []};

    for (const filename of files) {
        const text = await readFile(new URL(filename, notesDirectory), 'utf-8');
        // 仅匹配行首的二级标题，避免将 ### 或正文中的 ## 当成分隔符。
        // 适用于当前简单笔记；尚未处理代码块内恰好出现二级标题的情况。
        const searchUnits = text.split(/^##[\t ]+/m);
        for (const searchUnit of searchUnits) {
            const lines = searchUnit.trim().split(/\r?\n/);
            // 第一块可能是文件的一级标题和简介，也保留为可搜索内容。
            const heading = (lines[0] ?? '').replace(/^#[\t ]+/, '').trim();
            const body = lines.slice(1).join('\n').trim();
            const matched = `${heading}\n${body}`.toLowerCase().includes(keyword);
            if (matched) {
                result.matches.push({file: filename, heading, text: body});
                if (result.matches.length >= maxMatches) {
                    return result;
                }
            }
        }
    }

    return result;
}

/** 当前两个工具均只接收一个非空字符串字段，复用其运行时校验。 */
function readSingleStringArgument(args: unknown, key: string): string {
    if (
        typeof args !== 'object' || args === null || Array.isArray(args) ||
        !(key in args)
    ) {
        throw new Error(`参数必须是仅包含非空 ${key} 字符串的对象`);
    }

    const value: unknown = Reflect.get(args, key);
    if (
        typeof value !== 'string' || value.trim().length === 0 ||
        Object.keys(args).some((field) => field !== key)
    ) {
        throw new Error(`参数必须是仅包含非空 ${key} 字符串的对象`);
    }
    return value;
}

// 添加工具时，把它的描述和执行函数一起加入这里。
const registeredTools: RegisteredTool[] = [
    {
        definition: timeTool,
        execute: (args) => {
            const timezone = readSingleStringArgument(args, 'timezone');
            return { timezone, time: getCurrentTime(timezone) };
        }
    },
    {
        definition: searchNotesTool,
        execute: async (args) => {
            const query = readSingleStringArgument(args, 'query');
            return await searchNotes(query);
        }
    }
];

export const { toolDefinitions, executeTool } = createToolRegistry(registeredTools);
