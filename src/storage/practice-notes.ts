import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile, rename, rm } from 'node:fs/promises';

/** 输入内容不包含 ID 和时间；这些元数据由后端生成。 */
export type PracticeNoteInput = {
    problem: {
        title: string;
        number?: number;
        url?: string;
    };
    // 原始内容保留原样，不 trim 代码，不让整理结果覆盖原文。
    original: {
        thought: string;
        code: string;
        language: string;
        solution?: string;
    };
    // 整理结果不是已经通过运行验证的结论。
    summary: {
        approach: string;
        tags: string[];
        timeComplexity: string;
        spaceComplexity: string;
        pitfalls: string[];
        reviewPoints: string[];
    };
};

export type PracticeNote = PracticeNoteInput & {
    id: string;
    createdAt: string;
    updatedAt: string;
};

// 用户刷题笔记存放在被忽略的 data/ 下。
const notesDirectory = new URL('../../data/practice-notes/', import.meta.url);

/** 基础辅助函数已提供：将 unknown 缩小为可访问字段的对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 基础辅助函数已提供：限制 ID，避免输入被当作任意路径。 */
function noteFile(id: string, directory: URL): URL {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
        throw new Error('笔记 ID 格式不正确');
    }
    return new URL(`note_${id}.json`, directory);
}

/** 校验一个字符串；允许空字符串表示尚未整理，不修改原文。 */
function readString(value: unknown, name: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${name} 必须是字符串`);
    }
    return value;
}

/** 校验字符串数组，并返回独立的新数组。 */
function readStringArray(value: unknown, name: string): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`${name} 必须是数组`);
    }
    return value.map((item: unknown) => {
        if (typeof item !== 'string' || item.trim().length === 0) {
            throw new Error(`${name} 的每一项必须是非空字符串`);
        }
        return item.trim();
    });
}

export function parsePracticeNoteInput(value: unknown): PracticeNoteInput {
    if (!isRecord(value)) {
        throw new Error('笔记必须是对象');
    }

    const problem = value.problem;
    if (!isRecord(problem)) {
        throw new Error('problem 必须是对象');
    }

    if (typeof problem.title !== 'string' || problem.title.trim().length === 0) {
        throw new Error('题目标题不能为空');
    }

    const parsedProblem: PracticeNoteInput['problem'] = {
        title: problem.title.trim(),
    };

    if (problem.number !== undefined) {
        if (typeof problem.number !== 'number' || !Number.isSafeInteger(problem.number) || problem.number <= 0) {
            throw new Error('题号必须是正的安全整数');
        }
        parsedProblem.number = problem.number;
    }

    if (problem.url !== undefined) {
        if (typeof problem.url !== 'string') {
            throw new Error("题目链接必须是字符串");
        }

        let url: URL;

        try {
            url = new URL(problem.url);
        } catch {
            throw new Error('题目链接格式不正确');
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('题目链接必须使用 http 或 https');
        }
        parsedProblem.url = url.href;
    }


    const original = value.original;
    if (!isRecord(original)) {
        throw new Error('original 必须是对象');
    }
    if (typeof original.thought !== 'string' || typeof original.code !== 'string' || (original.thought.trim().length === 0 && original.code.trim().length === 0)) {
        throw new Error('code 和 thought 至少一个不为空');
    }
    let language = '';

    if (original.language !== undefined) {
        if (typeof original.language !== 'string') {
            throw new Error('language 必须是字符串');
        }

        language = original.language.trim();
    }

    const parsedOriginal: PracticeNoteInput['original'] = {
        thought: original.thought,
        code: original.code,
        language
    };

    if (original.solution !== undefined) {
        if (typeof original.solution !== 'string') {
            throw new Error('solution 必须是字符串');
        }

        parsedOriginal.solution = original.solution;
    }

    const summary = value.summary;
    if (!isRecord(summary)) {
        throw new Error('summary 必须是对象');
    }

    return {
        problem: parsedProblem,
        original: parsedOriginal,
        summary: {
            approach: readString(summary.approach, 'summary.approach'),
            tags: readStringArray(summary.tags, 'summary.tags'),
            timeComplexity: readString(summary.timeComplexity, 'summary.timeComplexity'),
            spaceComplexity: readString(summary.spaceComplexity, 'summary.spaceComplexity'),
            pitfalls: readStringArray(summary.pitfalls, 'summary.pitfalls'),
            reviewPoints: readStringArray(summary.reviewPoints, 'summary.reviewPoints'),
        },
    };
}

export function parsePracticeNote(value: unknown, expectedId: string): PracticeNote {
    // 这里只验证 ID，不读取或创建文件。
    noteFile(expectedId, notesDirectory);
    if (!isRecord(value)) {
        throw new Error('笔记文件内容必须是对象');
    }
    if (value.id !== expectedId) {
        throw new Error('笔记 ID 与文件 ID 不一致');
    }

    const createdAt = readString(value.createdAt, 'createdAt');
    const updatedAt = readString(value.updatedAt, 'updatedAt');
    const createdTime = Date.parse(createdAt);
    const updatedTime = Date.parse(updatedAt);
    if (!Number.isFinite(createdTime) || !Number.isFinite(updatedTime)) {
        throw new Error('笔记创建时间和更新时间必须是有效日期');
    }
    if (updatedTime < createdTime) {
        throw new Error('更新时间不能早于创建时间');
    }

    // 复用正文校验，不为损坏的文件自动补充 ID 或时间。
    const content = parsePracticeNoteInput(value);
    return { ...content, id: expectedId, createdAt, updatedAt };
}

/** 已提供：校验完整数据，创建目录，先写临时文件再替换正式文件。 */
async function writeNote(note: PracticeNote, directory: URL): Promise<void> {
    const checked = parsePracticeNote(note, note.id);
    const file = noteFile(checked.id, directory);
    const temporary = new URL(`${file.href}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
        await writeFile(temporary, JSON.stringify(checked, null, 2), 'utf8');
        await rename(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
}

/** TODO 3（已完成）：创建并保存笔记。
 * parsePracticeNoteInput(input) → randomUUID() → new Date().toISOString()
 * → 构造 PracticeNote（两个时间相同）→ await writeNote → return note。
 * 不接受输入指定 ID/时间；保存失败时不要返回成功。
 */
export async function createPracticeNote(
    input: unknown,
    directory: URL = notesDirectory,
): Promise<PracticeNote> {
    const practiceNoteInput = parsePracticeNoteInput(input);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    const practiceNote = {...practiceNoteInput, id, createdAt, updatedAt};
    await writeNote(practiceNote, directory);
    return practiceNote;
}

/** TODO 4（已完成）：按 ID 读取笔记。
 * noteFile → await readFile(..., 'utf8') → JSON.parse（赋给 unknown）
 * → parsePracticeNote(value, id) → return。
 * 缺失、损坏均继续抛错，不创建空笔记覆盖原文件。
 */
export async function getPracticeNote(
    id: string,
    directory: URL = notesDirectory,
): Promise<PracticeNote> {
    const file = noteFile(id, directory);
    const raw = await readFile(file, 'utf8');
    const value: unknown = JSON.parse(raw);
    return parsePracticeNote(value, id);
}

export async function updatePracticeNote(
    id: string,
    input: unknown,
    directory: URL = notesDirectory,
): Promise<PracticeNote> {
    const oldNote = await getPracticeNote(id, directory);
    const newInput = parsePracticeNoteInput(input);
    const newNote = {...newInput, id: oldNote.id, createdAt: oldNote.createdAt, updatedAt: new Date().toISOString()};

    await writeNote(newNote, directory);
    return newNote;
}


/** 小规模本地检索：多个条件取交集，返回摘要而非完整代码。 */
export async function searchPracticeNotes(
    filters: { query?: string; number?: number; tag?: string; limit?: number },
    directory: URL = notesDirectory,
    signal?: AbortSignal,
) {
    const limit = filters.limit ?? 10;
    const query = filters.query?.trim().toLowerCase() ?? '';
    const tag = filters.tag?.trim().toLowerCase();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { matches: [], total: 0 };
        throw error;
    }
    const matches = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        signal?.throwIfAborted();
        const match = /^note_([a-zA-Z0-9_-]{1,128})\.json$/.exec(entry.name);
        if (!entry.isFile() || !match) continue;
        const note = await getPracticeNote(match[1]!, directory);
        if (filters.number !== undefined && note.problem.number !== filters.number) continue;
        if (tag && !note.summary.tags.some(value => value.toLowerCase() === tag)) continue;
        const text = [note.problem.title, note.problem.number ?? '', note.original.thought,
            note.original.code, note.original.solution ?? '', note.summary.approach,
            ...note.summary.tags, ...note.summary.pitfalls, ...note.summary.reviewPoints].join('\n').toLowerCase();
        if (query && !text.includes(query)) continue;
        matches.push({ id: note.id, problem: note.problem, tags: note.summary.tags,
            approach: note.summary.approach.slice(0, 300), updatedAt: note.updatedAt });
    }
    matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return { matches: matches.slice(0, limit), total: matches.length };
}


/** 只删除指定笔记；不存在时抛错，不伪装成成功。已导出的文件保留。 */
export async function deletePracticeNote(id: string, directory: URL = notesDirectory, signal?: AbortSignal) {
    const file = noteFile(id, directory);
    const note = await getPracticeNote(id, directory);
    signal?.throwIfAborted();
    await rm(file);
    return { id, problem: note.problem, deleted: true };
}

/** 围栏长度大于代码中的反引号串，防止原始代码意外结束代码块。 */
export function practiceNoteToMarkdown(note: PracticeNote): string {
    const longest = Math.max(2, ...(note.original.code.match(/`+/g) ?? []).map(value => value.length));
    const fence = '`'.repeat(longest + 1);
    const language = /^[a-zA-Z0-9_+-]{1,30}$/.test(note.original.language) ? note.original.language : '';
    const list = (items: string[]) => items.length ? items.map(item => `- ${item}`).join('\n') : '暂无';
    return [
        `# ${note.problem.title.replace(/[\r\n]+/g, ' ')}`,
        `笔记 ID：${note.id}`,
        `题号：${note.problem.number ?? '未记录'}`,
        `题目链接：${note.problem.url ?? '未记录'}`,
        `创建时间：${note.createdAt}\n\n更新时间：${note.updatedAt}`,
        '## 用户原始内容',
        '### 思路', note.original.thought || '未提供',
        '### 代码', `${fence}${language}\n${note.original.code}${note.original.code.endsWith('\n') ? '' : '\n'}${fence}`,
        '### 原始题解', note.original.solution || '未提供',
        '## Agent 整理',
        '### 解题思路', note.summary.approach || '尚未整理',
        '### 标签', list(note.summary.tags),
        '### 复杂度', `时间：${note.summary.timeComplexity || '未分析'}\n\n空间：${note.summary.spaceComplexity || '未分析'}`,
        '### 易错点', list(note.summary.pitfalls),
        '### 复习要点', list(note.summary.reviewPoints),
    ].join('\n\n') + '\n';
}

/** 导出独立快照，文件名由后端生成，不接受外部路径，不覆盖之前的导出。 */
export async function exportPracticeNoteMarkdown(
    id: string,
    directory: URL = notesDirectory,
    exportsDirectory = new URL('../../data/exports/', import.meta.url),
    signal?: AbortSignal,
) {
    const note = await getPracticeNote(id, directory);
    const markdown = practiceNoteToMarkdown(note);
    const filename = `note_${note.id}_${randomUUID()}.md`;
    const file = new URL(filename, exportsDirectory);
    const temporary = new URL(`${file.href}.tmp`);
    signal?.throwIfAborted();
    await mkdir(exportsDirectory, { recursive: true });
    try {
        await writeFile(temporary, markdown, { encoding: 'utf8', flag: 'wx' });
        signal?.throwIfAborted();
        await rename(temporary, file);
    } finally {
        await rm(temporary, { force: true });
    }
    return { id: note.id, filename, path: fileURLToPath(file), bytes: Buffer.byteLength(markdown, 'utf8') };
}
