// 浏览器只调用自己的后端；API 密钥始终留在服务器。
const $ = (selector) => document.querySelector(selector);
const form = $('#message-form');
const input = $('#message-input');
const sendButton = $('#send-button');
const stopButton = $('#stop-button');
let activeRun = null;
stopButton.addEventListener('click', () => {
    activeRun?.abort();
    stopButton.disabled = true;
});
const newButton = $('#new-session');
const refreshButton = $('#refresh-history');
const openForm = $('#open-form');
const idInput = $('#conversation-id');
const openButton = $('#open-button');
const messages = $('#messages');
const status = $('#status');
const list = $('#conversation-list');
const storageKey = 'mini-agent.sessions.v1';
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
let current = null;
let busy = false;
let needsSync = false;
let storageAvailable = true;
let remembered = { selected: null, sessions: [] };
try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? localStorage.getItem('mini-fastgpt.sessions.v1') ?? 'null');
    if (saved && Array.isArray(saved.sessions)) {
        remembered.sessions = saved.sessions.filter(item => item && validId(item.id) && typeof item.title === 'string').slice(0, 50);
        remembered.selected = validId(saved.selected) ? saved.selected : null;
    }
} catch { storageAvailable = false; }

function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
}
function setBusy(value) {
    busy = value;
    sendButton.disabled = value || needsSync;
    newButton.disabled = value;
    refreshButton.disabled = value || !current;
    openButton.disabled = value;
    idInput.disabled = value;
    input.disabled = value;
    form.setAttribute('aria-busy', String(value));
    for (const button of list.querySelectorAll('button')) button.disabled = value;
}
function persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(remembered)); }
    catch { storageAvailable = false; }
}
function remember(conversation) {
    remembered.selected = conversation.id;
    remembered.sessions = [{ id: conversation.id, title: conversation.title }, ...remembered.sessions.filter(item => item.id !== conversation.id)].slice(0, 50);
    persist();
    renderList();
}
function renderList() {
    list.replaceChildren();
    for (const item of remembered.sessions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'session';
        button.textContent = item.title || '新会话';
        button.title = `${item.title}\n${item.id}`;
        button.setAttribute('aria-current', String(current?.id === item.id));
        button.disabled = busy;
        button.addEventListener('click', () => { if (!busy) void openConversation(item.id); });
        list.append(button);
    }
}
function addMessage(role, content) {
    const article = document.createElement('article');
    article.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = role === 'user' ? '你' : role === 'system' ? '系统' : '刷题助手';
    const body = document.createElement('div');
    body.className = 'message-body';
    renderBody(body, role, content);
    article.append(label, body);
    messages.append(article);
    messages.scrollTop = messages.scrollHeight;
    return body;
}
function renderBody(body, role, content) {
    if (role === 'assistant' && globalThis.marked && globalThis.DOMPurify) {
        const html = globalThis.marked.parse(content, { gfm: true, async: false });
        // Markdown 解析不负责安全清理，只允许文本排版所需的标签和属性。
        body.innerHTML = globalThis.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'strong', 'em', 'del', 's', 'blockquote', 'ul', 'ol', 'li',
                'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
            ALLOWED_ATTR: ['href', 'title', 'start', 'colspan', 'rowspan'],
            ALLOW_DATA_ATTR: false,
            ALLOW_ARIA_ATTR: false,
        });
        body.classList.add('markdown');
    } else {
        // 用户输入保持原样；渲染库未加载时也可以阅读纯文本。
        body.textContent = content;
    }
}
function renderMessages() {
    messages.replaceChildren();
    $('#session-title').textContent = current?.title ?? '开始一次 Agent 刷题任务';
    $('#session-id').textContent = current ? `会话 ID：${current.id}` : '发送第一条消息时自动创建会话';
    if (!current?.messages.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        // 这里仅使用固定模板，所有外部内容都通过 textContent 添加。
        empty.innerHTML = '<div class="mark" aria-hidden="true">✦</div><h2>今天想攻克哪道题？</h2><p>贴上题号与题目描述，分享你的思路和代码。一起拆解难点、分析复杂度，整理本次解题的复盘草稿。</p><div class="suggestions"></div>';
        for (const text of ['我在做两数之和，先给我一点提示，不要直接给完整代码。', '我想分析一段代码的时间和空间复杂度，请先让我提供代码。', '帮我把这次解题过程整理成复盘草稿，请先询问我的思路、代码和遇到的问题。']) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.addEventListener('click', () => { if (!busy) { input.value = text; input.focus(); } });
            empty.querySelector('.suggestions').append(button);
        }
        messages.append(empty);
    } else {
        for (const message of current.messages) {
            const body = addMessage(message.role, message.content);
            renderTurnRecord(body, message);
        }
    }
}
async function request(path, body) {
    const response = await fetch(path, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error(`服务器返回了无法解析的响应（${response.status}）`); }
    if (!response.ok) {
        const error = new Error(data.error?.message ?? `请求失败：${response.status}`);
        error.code = data.error?.code;
        throw error;
    }
    return data;
}
// 一次 read 不等于一个事件：网络可能拆分 UTF-8 字符和 JSON 行。
async function requestStream(body, onEvent, signal) {
    const response = await fetch('/api/agent/stream', {
        signal,
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message ?? `请求失败：${response.status}`);
    }
    if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
        throw new Error('服务器未返回 Agent 事件流，请重启后端');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line) continue;
                const event = JSON.parse(line);
                if (event.type === 'error') throw new Error(event.message);
                if (event.type === 'done') {
                    if (event.conversationId !== body.conversationId || typeof event.reply !== 'string') {
                        throw new Error('结束事件不合法');
                    }
                    return event;
                }
                if (event.type === 'delta' && typeof event.text !== 'string') throw new Error('文本事件不合法');
                onEvent(event);
            }
            if (buffer.length > 2 * 1024 * 1024) throw new Error('流事件超过大小限制');
            if (done) throw new Error('连接提前结束，未收到保存成功确认');
        }
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
const pretty = value => { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return String(value); } };
const duration = value => typeof value === 'number' ? `${value.toLocaleString()} ms` : '耗时未记录';
const usageText = usage => usage
    ? `Token：输入 ${usage.inputTokens.toLocaleString()} / 输出 ${usage.outputTokens.toLocaleString()} / 合计 ${usage.totalTokens.toLocaleString()}`
    : 'Token：未提供（不按 0 统计）';
function toolCard(call) {
    const card = document.createElement('details');
    card.className = 'tool-card';
    const heading = document.createElement('summary');
    let description = call.resultStatus ?? '历史调用（未记录结果状态）';
    if (!call.resultStatus && call.output !== undefined) {
        try {
            const result = JSON.parse(call.output);
            description = result.ok === false ? '调用失败' : call.name === 'run_python'
                ? result.executionSucceeded ? '程序正常退出' : `执行未成功：${result.status ?? '未知状态'}`
                : '调用成功';
        } catch { description = '结果无法解析'; }
    }
    heading.textContent = `${call.name} · ${description} · ${duration(call.durationMs)}`;
    const detail = document.createElement('pre');
    detail.textContent = `${call.callId ? `调用 ID：${call.callId}\n\n` : ''}参数\n${pretty(call.argumentsJson)}` +
        (call.output !== undefined ? `\n\n结果\n${pretty(call.output)}` : '');
    card.append(heading, detail);
    return card;
}
function appendModelText(body, text) {
    const block = document.createElement('div');
    block.className = 'model-text';
    renderBody(block, 'assistant', text);
    body.append(block);
    return block;
}
function renderTurnRecord(body, message) {
    const calls = message.toolCalls ?? [];
    if (!message.metrics && !calls.length) return;
    body.replaceChildren();
    let offset = 0;
    // 旧记录没有位置，无法反推当时顺序：保留正文在前、工具在后的显示。
    const positioned = calls.every(call => Number.isInteger(call.textOffset) && call.textOffset >= 0 && call.textOffset <= message.content.length) &&
        calls.every((call, index) => index === 0 || call.textOffset >= calls[index - 1].textOffset);
    for (const call of calls) {
        const end = positioned ? call.textOffset : message.content.length;
        if (end > offset) appendModelText(body, message.content.slice(offset, end));
        body.append(toolCard(call));
        offset = end;
    }
    if (offset < message.content.length) appendModelText(body, message.content.slice(offset));
    if (message.metrics) {
        const summary = document.createElement('p');
        summary.className = 'turn-summary';
        summary.textContent = `总耗时 ${duration(message.metrics.durationMs)} · ${usageText(message.metrics.usage)}`;
        body.append(summary);
    }
}
const loadConversation = (id) => request(`/api/conversations/${encodeURIComponent(id)}`);
function acceptConversation(conversation) {
    current = conversation;
    needsSync = false;
    remember(current);
    renderMessages();
}
function readyStatus(text) {
    setStatus(text + (storageAvailable ? '' : '（浏览器存储不可用，请保留会话 ID。）'));
}
async function openConversation(id) {
    if (busy) return;
    if (!validId(id)) { setStatus('会话 ID 格式不正确。', true); return; }
    setBusy(true);
    setStatus('正在读取历史…');
    try {
        acceptConversation(await loadConversation(id));
        readyStatus('历史已加载。');
    } catch (error) {
        if (error.code === 'CONVERSATION_NOT_FOUND') {
            remembered.sessions = remembered.sessions.filter(item => item.id !== id);
            if (remembered.selected === id) remembered.selected = null;
            persist();
            renderList();
        }
        setStatus(`读取失败：${error.message}。可以重试或新建会话。`, true);
    } finally { setBusy(false); }
}
newButton.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    setStatus('正在创建会话…');
    try {
        acceptConversation(await request('/api/conversations', {}));
        readyStatus('新会话已创建。');
    } catch (error) { setStatus(error.message, true); }
    finally { setBusy(false); input.focus(); }
});
openForm.addEventListener('submit', event => {
    event.preventDefault();
    void openConversation(idInput.value.trim());
});
refreshButton.addEventListener('click', () => { if (current && !busy) void openConversation(current.id); });
input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!busy && !needsSync) form.requestSubmit();
    }
});
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || needsSync) return;
    const message = input.value.trim();
    if (!message || message.length > 10000) {
        setStatus('请输入 1～10000 个字符的问题。', true);
        return;
    }
    setBusy(true);
    setStatus('正在发送，请等待本轮完成…');
    let submitted = false;
    let answer;
    let textBlock;
    let blockText = "";
    let renderTimer;
    try {
        if (!current) acceptConversation(await request('/api/conversations', {}));
        if (!current.messages.length) messages.replaceChildren();
        addMessage('user', message);
        $('#pending').hidden = false;
        submitted = true;
        answer = addMessage('assistant', '');
        answer.replaceChildren();
        activeRun = new AbortController();
        stopButton.hidden = false;
        stopButton.disabled = false;
        const data = await requestStream({ conversationId: current.id, message }, event => {
            if (event.type === 'delta') {
                if (!textBlock) { textBlock = appendModelText(answer, ''); blockText = ''; }
                blockText += event.text;
                $('#pending').hidden = true;
                setStatus('正在生成…');
                // 合并高频片段，减少重复 Markdown 渲染。
                if (!renderTimer) renderTimer = setTimeout(() => {
                    renderTimer = undefined;
                    renderBody(textBlock, 'assistant', blockText);
                    messages.scrollTop = messages.scrollHeight;
                }, 40);
            } else if (event.type === 'memory') {
                if (typeof event.message === 'string') setStatus(event.message, event.status === 'warning');
            } else if (event.type === 'tool') {
                if (renderTimer) { clearTimeout(renderTimer); renderTimer = undefined; }
                if (textBlock) renderBody(textBlock, 'assistant', blockText);
                answer.append(toolCard(event));
                textBlock = undefined;
                blockText = '';
                $('#pending').hidden = true;
                setStatus(`工具 ${event.name} 已返回，正在继续生成…`);
                messages.scrollTop = messages.scrollHeight;
            }
        }, activeRun.signal);
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = undefined; }
        current.messages.push({ role: 'user', content: message }, { role: 'assistant', content: data.reply, toolCalls: data.toolCalls ?? [], metrics: data.metrics });
        current.title = data.title ?? current.title;
        remember(current);
        renderMessages();
        input.value = '';
        const memoryWarnings = (data.memoryEvents ?? []).filter(event => event.status === 'warning');
        const memoryResult = (data.memoryEvents ?? []).findLast(event => event.phase !== 'recall' && event.status === 'success');
        if (memoryWarnings.length) setStatus('回答已保存。' + memoryWarnings.map(event => event.message).join('；'), true);
        else readyStatus('回答已保存。' + (memoryResult ? memoryResult.message : ''));
    } catch (error) {
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = undefined; }
        if (activeRun?.signal.aborted) {
            if (answer) {
                if (textBlock) renderBody(textBlock, 'assistant', blockText);
                appendModelText(answer, '\n\n[已停止，内容可能不完整]');
            }
            try {
                const saved = await loadConversation(current.id);
                const completed = saved.messages.length > current.messages.length;
                current = saved;
                remember(current);
                if (completed) {
                    renderMessages();
                    input.value = '';
                    setStatus('取消时本轮已完成保存，已恢复服务器历史。');
                } else {
                    setStatus('已停止，内容可能不完整。后端正在取消并清理；若恰好开始保存，请稍后刷新历史核对。');
                }
            } catch {
                needsSync = true;
                setStatus('已停止，暂时无法核对保存状态，请刷新历史后继续。');
            }
            return;
        }
        let note = '';
        if (submitted) {
            // 网络/存储报错时，写入可能已经成功，重新读取服务器记录。
            try {
                current = await loadConversation(current.id);
                needsSync = false;
                remember(current);
                renderMessages();
                note = ' 已重新读取历史；连接中断时后端可能仍在处理，请稍后刷新核对，勿立即重复提交。';
            } catch {
                needsSync = true;
                renderMessages();
                note = ' 暂时无法确认保存状态，请先点击“刷新历史”再发送。';
            }
        }
        setStatus(error.message + note, true);
    } finally {
        activeRun = null;
        stopButton.hidden = true;
        $('#pending').hidden = true;
        setBusy(false);
        input.focus();
    }
});
renderList();
renderMessages();
setBusy(false);
if (remembered.selected) {
    idInput.value = remembered.selected;
    void openConversation(remembered.selected);
} else {
    readyStatus('准备好了，贴上题目和你的思路，一起开始分析。');
}
