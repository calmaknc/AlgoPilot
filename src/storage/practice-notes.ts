import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';

/** 正文是用户自由编写的 Markdown；题目关联和标签仅用于管理。 */
export type PracticeNoteInput = {
    title: string;
    content: string;
    tags: string[];
    problem?: { number?: number; url?: string };
};
export type PracticeNote = PracticeNoteInput & {
    schemaVersion: 2;
    id: string;
    createdAt: string;
    updatedAt: string;
};

// SQLite 使用独立目录，不读取或迁移旧 JSON 笔记。
const notesDirectory = new URL('../../data/practice-notes/', import.meta.url);
const MAX_CONTENT_BYTES = 32 * 1024;
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validateNoteId(id: string): void {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('笔记 ID 格式不正确');
}
function readString(value: unknown, name: string): string {
    if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`);
    return value;
}
export function parsePracticeNoteInput(value: unknown): PracticeNoteInput {
    if (!isRecord(value)) throw new Error('笔记必须是对象');
    const title = readString(value.title, 'title').trim();
    const content = readString(value.content, 'content');
    if (!title || title.length > 200 || /[\r\n]/.test(title)) throw new Error('标题必须为 1～200 字符的单行文本');
    if (!content.trim() || Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new Error('正文不能为空且不能超过 32 KiB');
    const tags = value.tags === undefined ? [] : value.tags;
    if (!Array.isArray(tags) || tags.length > 50 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 100)) throw new Error('tags 必须是最多 50 个非空短字符串');
    const result: PracticeNoteInput = { title, content, tags: tags.map(tag => tag.trim()) };
    if (value.problem !== undefined) {
        if (!isRecord(value.problem) || Object.keys(value.problem).some(key => !['number', 'url'].includes(key))) throw new Error('problem 格式不正确');
        const { number, url } = value.problem;
        result.problem = {};
        if (number !== undefined) {
            if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) throw new Error('题号必须是正的安全整数');
            result.problem.number = number;
        }
        if (url !== undefined) {
            if (typeof url !== 'string') throw new Error('题目链接必须是字符串');
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('题目链接必须使用 http 或 https');
            result.problem.url = url;
        }
    }
    return result;
}

export function parsePracticeNote(value: unknown, expectedId: string): PracticeNote {
    validateNoteId(expectedId);
    if (!isRecord(value)) {
        throw new Error('笔记内容必须是对象');
    }
    if (value.schemaVersion !== 2) throw new Error('不支持的笔记格式，仅支持 schemaVersion 2');
    if (value.id !== expectedId) {
        throw new Error('笔记 ID 与预期 ID 不一致');
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

    // 复用正文校验，不为损坏的记录自动补充 ID 或时间。
    const content = parsePracticeNoteInput(value);
    return { ...content, schemaVersion: 2, id: expectedId, createdAt, updatedAt };
}

/** 每次操作关闭连接；更新和删除在同一事务内完成读取与写入。 */
async function withDatabase<T>(directory: URL, operation: (db: DatabaseSync) => T): Promise<T> {
    await mkdir(directory, { recursive: true });
    const db = new DatabaseSync(fileURLToPath(new URL('notes.sqlite', directory)));
    try {
        db.exec(`
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL,
                problem TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            ) STRICT;
        `);
        return operation(db);
    } finally {
        db.close();
    }
}

function transaction<T>(db: DatabaseSync, operation: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = operation();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

function rowToNote(row: Record<string, unknown>): PracticeNote {
    return parsePracticeNote({
        schemaVersion: 2, id: row.id, title: row.title, content: row.content,
        tags: JSON.parse(readString(row.tags, 'tags')),
        ...(row.problem === null ? {} : { problem: JSON.parse(readString(row.problem, 'problem')) }),
        createdAt: row.created_at, updatedAt: row.updated_at,
    }, readString(row.id, 'id'));
}

function readNote(db: DatabaseSync, id: string): PracticeNote {
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    if (!row) throw new Error('笔记不存在');
    return rowToNote(row);
}

function writeNote(db: DatabaseSync, note: PracticeNote): void {
    const checked = parsePracticeNote(note, note.id);
    db.prepare(`INSERT INTO notes (id, title, content, tags, problem, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, content = excluded.content,
            tags = excluded.tags, problem = excluded.problem, updated_at = excluded.updated_at`)
        .run(checked.id, checked.title, checked.content, JSON.stringify(checked.tags),
            checked.problem === undefined ? null : JSON.stringify(checked.problem),
            checked.createdAt, checked.updatedAt);
}

export async function createPracticeNote(
    input: unknown,
    directory: URL = notesDirectory,
): Promise<PracticeNote> {
    const practiceNoteInput = parsePracticeNoteInput(input);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const updatedAt = createdAt;
    const practiceNote: PracticeNote = {...practiceNoteInput, schemaVersion: 2, id, createdAt, updatedAt};
    await withDatabase(directory, db => writeNote(db, practiceNote));
    return practiceNote;
}

export async function getPracticeNote(
    id: string,
    directory: URL = notesDirectory,
): Promise<PracticeNote> {
    validateNoteId(id);
    return withDatabase(directory, db => readNote(db, id));
}

export async function updatePracticeNote(
    id: string,
    input: unknown,
    directory: URL = notesDirectory,
): Promise<PracticeNote> {
    validateNoteId(id);
    return withDatabase(directory, db => transaction(db, () => {
        const oldNote = readNote(db, id);
        if (!isRecord(input) || !Object.keys(input).length || Object.keys(input).some(key => !['title', 'content', 'tags', 'problem', 'appendContent'].includes(key))) throw new Error('更新必须包含有效的修改字段');
        if ('content' in input && 'appendContent' in input) throw new Error('content 与 appendContent 不能同时使用');
        const merged: Record<string, unknown> = { ...oldNote, ...input };
        if ('appendContent' in input) {
            const addition = readString(input.appendContent, 'appendContent');
            if (!addition.trim()) throw new Error('追加内容不能为空');
            // 原样拼接，调用方显式提供所需的换行。
            merged.content = oldNote.content + addition;
        }
        if (input.problem === null) delete merged.problem;
        const newInput = parsePracticeNoteInput(merged);
        const newNote: PracticeNote = {...newInput, schemaVersion: 2, id: oldNote.id, createdAt: oldNote.createdAt, updatedAt: new Date().toISOString()};

        writeNote(db, newNote);
        return newNote;
    }));
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
    signal?.throwIfAborted();
    return withDatabase(directory, db => {
        const matches = [];
        for (const row of db.prepare('SELECT * FROM notes').iterate()) {
            signal?.throwIfAborted();
            const note = rowToNote(row);
            if (filters.number !== undefined && note.problem?.number !== filters.number) continue;
            if (tag && !note.tags.some(value => value.toLowerCase() === tag)) continue;
            const text = [note.title, note.content, ...note.tags].join('\n').toLowerCase();
            if (query && !text.includes(query)) continue;
            const matchAt = query ? note.content.toLowerCase().indexOf(query) : 0;
            const start = Math.max(0, matchAt - 80);
            matches.push({ id: note.id, title: note.title, problem: note.problem, tags: note.tags,
                excerpt: note.content.slice(start, start + 300), updatedAt: note.updatedAt });
        }
        matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
        return { matches: matches.slice(0, limit), total: matches.length };
    });
}


/** 只删除指定笔记；不存在时抛错，不伪装成成功。已导出的文件保留。 */
export async function deletePracticeNote(id: string, directory: URL = notesDirectory, signal?: AbortSignal) {
    validateNoteId(id);
    signal?.throwIfAborted();
    return withDatabase(directory, db => transaction(db, () => {
        const note = readNote(db, id);
        signal?.throwIfAborted();
        db.prepare('DELETE FROM notes WHERE id = ?').run(id);
        return { id, title: note.title, deleted: true };
    }));
}

/** 添加题号与标题，正文原样保留，不改写代码围栏。 */
export function practiceNoteToMarkdown(note: PracticeNote): string {
    const title = note.problem?.number === undefined
        ? note.title
        : `${note.problem.number}. ${note.title}`;
    return `# ${title}\n\n${note.content}`;
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
