/** DeepSeek 搜索与抓取：仅请求远端，不缓存或写入网页正文。 */
const BASE_URL = 'https://api.deepseek.com/v1/tools/';
export const WEB_LIMITS = { timeoutMs: 30_000, responseBytes: 2 * 1024 * 1024, results: 5, contentChars: 8000, pageChars: 24000 } as const;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const clip = (text: string, limit: number) => ({ text: text.slice(0, limit), truncated: text.length > limit });

export function validateWebUrl(value: string): string {
    if (value.length > 8192) throw new Error('URL 不能超过 8192 个字符');
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('请输入有效的 HTTP/HTTPS URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
        throw new Error('URL 必须为不带用户名和密码的 HTTP/HTTPS 地址');
    }
    return url.href;
}

export function createWebClient(options: { fetch?: typeof fetch; apiKey?: () => string | undefined; timeoutMs?: number } = {}) {
    const request = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    async function post(endpoint: 'search' | 'fetch', body: object, signal?: AbortSignal): Promise<unknown> {
        signal?.throwIfAborted();
        const apiKey = (options.apiKey ?? (() => process.env.DEEPSEEK_API_KEY))();
        if (!apiKey) throw new Error('请配置 DEEPSEEK_API_KEY');
        const controller = new AbortController();
        const cancel = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(() => controller.abort(new Error('网页请求超时')), options.timeoutMs ?? WEB_LIMITS.timeoutMs);
        try {
            const response = await request(BASE_URL + endpoint, {
                method: 'POST', redirect: 'error', signal: controller.signal,
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                await response.body?.cancel();
                const descriptions: Record<number, string> = {
                    401: 'API Key 无效', 402: '账户余额不足', 403: '抓取被拒绝',
                    404: '未能获取网页正文', 429: '请求过于频繁，请稍后再试', 504: '远端服务超时',
                };
                throw new Error(`DeepSeek ${endpoint} HTTP ${response.status}：${descriptions[response.status] ?? '请求失败'}`);
            }
            if (!response.body) throw new Error('DeepSeek 网页接口没有返回正文');
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    controller.signal.throwIfAborted();
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > WEB_LIMITS.responseBytes) throw new Error('网页接口响应超过大小限制');
                    chunks.push(value);
                }
            } finally {
                await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
            controller.signal.throwIfAborted();
            try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { throw new Error('DeepSeek 网页接口返回了无效 JSON'); }
        } catch (error) {
            signal?.throwIfAborted(); // 用户取消向上抛出，不变成普通工具失败。
            if (controller.signal.aborted) throw new Error('网页请求超时');
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        }
    }
    return {
        async search(query: string, signal?: AbortSignal) {
            query = query.trim();
            if (!query || Array.from(query).length > 128) throw new Error('query 必须为 1～128 个 Unicode 字符');
            const data = await post('search', { query, count: WEB_LIMITS.results, need_content: true }, signal);
            if (!isObject(data) || !Array.isArray(data.results)) throw new Error('搜索响应结构不正确');
            const results = data.results.slice(0, WEB_LIMITS.results).map((item: unknown) => {
                if (!isObject(item) || typeof item.title !== 'string' || typeof item.url !== 'string' ||
                    typeof item.summary !== 'string' || typeof item.content !== 'string') throw new Error('搜索结果结构不正确');
                const content = clip(item.content, WEB_LIMITS.contentChars);
                const summary = clip(item.summary, 2000);
                return { title: item.title.slice(0, 500), url: validateWebUrl(item.url), summary: summary.text,
                    summaryTruncated: summary.truncated, content: content.text, contentTruncated: content.truncated,
                    contentAvailable: item.content.trim().length > 0 };
            });
            return { query, results, resultsTruncated: data.results.length > results.length, retrievedAt: new Date().toISOString() };
        },
        async readPage(url: string, signal?: AbortSignal) {
            url = validateWebUrl(url);
            const data = await post('fetch', { url }, signal);
            if (!isObject(data) || typeof data.title !== 'string' || typeof data.content !== 'string') throw new Error('网页响应结构不正确');
            if (!data.content.trim()) throw new Error('未能获取网页正文，不能将摘要当作完整题干');
            const content = clip(data.content, WEB_LIMITS.pageChars);
            return { url, title: data.title.slice(0, 500), content: content.text, contentTruncated: content.truncated, retrievedAt: new Date().toISOString() };
        },
    };
}
export type WebClient = ReturnType<typeof createWebClient>;
