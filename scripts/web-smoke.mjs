// 显式运行真实接口（按请求计费）；只输出验证摘要，不保存网页缓存。
import { executeTool } from '../src/tools/index.ts';
const cases = [
    { number: 1, slug: 'two-sum', marker: /target|目标值/i },
    { number: 20, slug: 'valid-parentheses', marker: /bracket|括号/i },
    { number: 1234, slug: 'replace-the-substring-for-balanced-string', marker: /QWER|Q.*W.*E.*R/s },
];
for (const item of cases) {
    const start = performance.now();
    const search = JSON.parse(await executeTool('web_search', JSON.stringify({ query: `LeetCode ${item.number} site:leetcode.cn` })));
    if (!search.ok) {
        console.log(JSON.stringify({ number: item.number, searchOk: false, error: search.error }));
        process.exitCode = 1;
        continue;
    }
    const target = search.results.find(result => {
        const url = new URL(result.url);
        return ['leetcode.cn', 'leetcode.com'].includes(url.hostname) &&
            new RegExp(`^/(?:classic/)?problems/${item.slug}/(?:description/?)?$`).test(url.pathname);
    });
    // Fetch 独立使用已知官方测试 URL，不将它冒充为搜索定位成功。
    const url = target?.url ?? `https://leetcode.cn/problems/${item.slug}/description/`;
    const page = JSON.parse(await executeTool('read_webpage', JSON.stringify({ url })));
    const checks = page.ok ? {
        topic: item.marker.test(page.content),
        examples: /示例|Example/i.test(page.content),
        constraints: /提示|Constraints|约束/i.test(page.content),
        notTruncated: !page.contentTruncated,
    } : {};
    const passed = page.ok && Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ number: item.number, searchOk: true, matched: Boolean(target), title: page.title,
        url, urlSource: target ? 'search' : 'known-fixture', candidates: search.results.map(r => ({title:r.title,url:r.url})), fetchOk: page.ok, chars: page.content?.length, checks, passed,
        error: page.error, durationMs: Math.round(performance.now() - start) }));
    if (!passed) process.exitCode = 1;
}
