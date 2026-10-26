import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';

export const MEMORY_TYPES = ['user', 'behavior', 'project', 'reference'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];
export type MemoryDraft = { name: string; description: string; type: MemoryType; content: string; evidence: string };
export type MemoryRecord = MemoryDraft & { createdAt: string; updatedAt: string };
export type MemorySnapshot = { index: string; revision: string; memories: MemoryRecord[] };

const defaultDirectory = new URL('../../data/memory/', import.meta.url);
const namePattern = /^[a-z][a-z0-9-]{0,79}$/;
const indexPattern = /^\[([a-z][a-z0-9-]{0,79})\]\((entries\/[a-z][a-z0-9-]{0,79}\.[0-9a-f-]{36}\.md)\) — (user|behavior|project|reference): (.+)$/;
const fields = ['name', 'description', 'type', 'evidence', 'createdAt', 'updatedAt'] as const;

export function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function memoryDraft(value: unknown): MemoryDraft {
    if (!record(value)) throw new Error('记忆必须是对象');
    const { name, description, type, content, evidence } = value;
    if (typeof name !== 'string' || !namePattern.test(name)) throw new Error('记忆名称必须为小写英文、数字或短横线，且以字母开头');
    if (typeof description !== 'string' || !description.trim() || description.length > 240 || /[\r\n]/.test(description)) throw new Error('记忆描述必须是最多 240 字符的单行文本');
    if (!MEMORY_TYPES.includes(type as MemoryType)) throw new Error('记忆类型不正确');
    if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content) > 8000) throw new Error('记忆正文不能为空且不能超过 8 kB');
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 1000) throw new Error('记忆必须附带最多 1000 字符的来源依据');
    return { name, description, type: type as MemoryType, content, evidence };
}

export function memoryMarkdown(memory: MemoryRecord): string {
    // JSON 字符串也是合法 YAML 双引号标量，换行/引号不会逃逸 frontmatter。
    return `---\n${fields.map(key => `${key}: ${JSON.stringify(memory[key])}`).join('\n')}\n---\n\n${memory.content}`;
}

export function parseMemoryMarkdown(text: string): MemoryRecord {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?([\s\S]*)$/.exec(text);
    if (!match) throw new Error('记忆缺少 YAML frontmatter');
    const metadata: Record<string, unknown> = {};
    for (const line of match[1]!.split(/\r?\n/)) {
        const field = /^([a-zA-Z]+): (.*)$/.exec(line);
        if (!field || !fields.includes(field[1] as typeof fields[number]) || field[1]! in metadata) throw new Error('记忆元数据字段不正确或重复');
        // 文件由本模块生成；也接受示例中的简单未加引号单行标量。
        metadata[field[1]!] = field[2]!.startsWith('"') ? JSON.parse(field[2]!) : field[2];
    }
    const parsed = memoryDraft({ ...metadata, content: match[2] });
    if (typeof metadata.createdAt !== 'string' || typeof metadata.updatedAt !== 'string' || !Number.isFinite(Date.parse(metadata.createdAt)) || !Number.isFinite(Date.parse(metadata.updatedAt)) || Date.parse(metadata.updatedAt) < Date.parse(metadata.createdAt)) throw new Error('记忆时间无效');
    return { ...parsed, createdAt: metadata.createdAt, updatedAt: metadata.updatedAt };
}

/** 不可变记忆文件 + 原子替换索引；并发修改使用目录锁和版本比较，避免覆盖别的会话。 */
export function createMemoryStore(directory = defaultDirectory) {
    const indexFile = new URL('memory.md', directory);
    const lockDirectory = new URL('.write-lock/', directory);

    async function locked<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();
        await mkdir(new URL('entries/', directory), { recursive: true, mode: 0o700 });
        try { await mkdir(lockDirectory, { mode: 0o700 }); }
        catch (error) {
            if (record(error) && error.code === 'EEXIST') throw new Error('记忆正被其他会话修改，请稍后重试；若进程异常退出，请检查 .write-lock');
            throw error;
        }
        try { signal?.throwIfAborted(); return await fn(); }
        finally { await rm(lockDirectory, { recursive: true, force: true }); }
    }

    async function readUnlocked(): Promise<MemorySnapshot & { paths: string[] }> {
        try { await writeFile(indexFile, '', { flag: 'wx', mode: 0o600 }); }
        catch (error) { if (!record(error) || error.code !== 'EEXIST') throw error; }
        if (!(await lstat(indexFile)).isFile()) throw new Error('记忆索引必须是普通文件');
        if ((await lstat(indexFile)).size > 100_000) throw new Error('记忆索引过大');
        const index = await readFile(indexFile, 'utf8');
        const memories: MemoryRecord[] = [], paths: string[] = [];
        const names = new Set<string>();
        for (const line of index.trimEnd().split('\n').filter(Boolean)) {
            const match = indexPattern.exec(line);
            if (!match) throw new Error('记忆索引链接格式不正确');
            const [, name, path, type, description] = match;
            if (names.has(name!)) throw new Error('记忆名称重复');
            names.add(name!);
            const file = new URL(path!, directory);
            const info = await lstat(file);
            if (!info.isFile() || info.size > 20_000) throw new Error('记忆文件不合法或过大');
            const memory = parseMemoryMarkdown(await readFile(file, 'utf8'));
            if (memory.name !== name || memory.type !== type || memory.description !== description) throw new Error('记忆索引与文件不一致');
            memories.push(memory); paths.push(path!);
        }
        if (memories.length > 50 || Buffer.byteLength(JSON.stringify(memories)) > 200_000) throw new Error('记忆库超过安全读取上限');
        return { index, revision: createHash('sha256').update(index).update(JSON.stringify(memories)).digest('hex'), memories, paths };
    }

    async function read(signal?: AbortSignal): Promise<MemorySnapshot> {
        return locked(readUnlocked, signal);
    }
    
    async function replace(expectedRevision: string, memories: MemoryRecord[], signal?: AbortSignal) {
        return locked(async () => {
            const current = await readUnlocked();
            if (current.revision !== expectedRevision) throw new Error('记忆已被其他会话更新，本次变更未写入，请重试');
            const checked = memories.map(memory => parseMemoryMarkdown(memoryMarkdown({ ...memory, ...memoryDraft(memory) })));
            if (checked.length > 50 || new Set(checked.map(memory => memory.name)).size !== checked.length || Buffer.byteLength(JSON.stringify(checked)) > 200_000) throw new Error('记忆数量、大小或名称重复超限');
            const created: URL[] = [];
            const temporary = new URL(`index-${randomUUID()}.tmp`, directory);
            let committed = false;
            try {
                const lines: string[] = [];
                for (const memory of checked) {
                    signal?.throwIfAborted();
                    const path = `entries/${memory.name}.${randomUUID()}.md`;
                    const file = new URL(path, directory);
                    created.push(file);
                    await writeFile(file, memoryMarkdown(memory), { flag: 'wx', mode: 0o600, signal });
                    lines.push(`[${memory.name}](${path}) — ${memory.type}: ${memory.description}`);
                }
                const index = lines.length ? lines.join('\n') + '\n' : '';
                await writeFile(temporary, index, { flag: 'wx', mode: 0o600, signal });
                signal?.throwIfAborted();
                // 提交边界：此后不中断，索引始终只指向完整文件。
                await rename(temporary, indexFile);
                committed = true;
                const cleanup = await Promise.allSettled(current.paths.map(path => rm(new URL(path, directory), { force: true })));
                return { cleanupFailed: cleanup.some(result => result.status === 'rejected') };
            } finally {
                await rm(temporary, { force: true });
                if (!committed) await Promise.all(created.map(file => rm(file, { force: true })));
            }
        }, signal);
    }
    return { read, replace };
}
