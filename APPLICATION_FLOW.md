# Mini Agent：对照代码理解整个应用

更新日期：2026-10-22。下文主体讲解原生 HTTP 版本；Express 迁移后的对应关系如下。

- 新入口 `src/http/server.ts` 监听 3001，调用 `src/http/app.ts` 中的 `createExpressApp()`；原生 HTTP 版本已归档至 `src/archive/`，供学习对照。
- 路由、媒体类型检查、JSON 解析、64 KiB 限制、405/404 和统一错误处理中间件都在 `src/http/app.ts`。业务服务、模型循环、工具和存储继续复用。
- Express 默认支持 GET 对应的 HEAD；错误路径编码返回 400；错误 JSON 返回 400，超限返回 413，媒体类型不支持返回 415。
- `express.static` 只提供 `public/` 里的网页文件，浏览器打开 `http://127.0.0.1:3001/`。`app.js` 在浏览器运行，已接通网页交互、新建和读取会话。网页通过 Agent 流式接口增量展示文本和工具执行结果。
- 启动：`node --env-file=.env src/http/server.ts`。
- 新增 `test/express.test.mjs`：使用临时存储和模拟模型，通过真实本机 HTTP 验证路由、两轮历史、模型失败、并发冲突及静态文件；测试环境需要允许监听本机端口。

向量检索尚未实现；网页流式交互与取消执行已接通，取消流程见第 18 节。

阅读时可以在编辑器里同时打开本文和对应文件。建议顺序：`main.ts` → `src/http/app.ts` → `src/agent/service.ts` → `runner.ts` → `src/tools/registry.ts` → `src/tools/index.ts` → `src/storage/conversations.ts`。


## 当前目录与启动方式

源码按职责迁移到 `src/`，前端静态资源仍在 `public/`，测试仍在 `test/`。

```text
src/
├── http/        # app.ts 路由与中间件，server.ts 监听端口
├── cli/         # main.ts 命令行交互入口
├── agent/       # service.ts 交互业务，runner.ts 执行循环，messages.ts 消息类型
├── tools/       # index.ts 注册清单，implementations.ts 工具实现，registry.ts 通用分派
├── sandbox/     # runner.ts 容器执行，service.ts 参数校验与并发控制
├── storage/     # conversations.ts 会话存储，practice-notes.ts 刷题笔记存储
├── shared/      # errors.ts 公共业务错误
├── examples/    # sandbox-demo.ts 手动验证入口
└── archive/     # 早期练习与参考实现，不作为正式服务入口
```

从项目根目录启动：

```bash
npm start                  # 网页/API 服务，读取 .env
npm run agent               # 命令行交互，读取 .env
npm run sandbox:demo -- hello
npm run typecheck
npm test
```

运行数据路径保持 `data/conversations/`、`data/practice-notes/`；本次只整理源码，未移动或改写数据。下文保留演进过程；当前网页使用第 17 节的流式接口与本轮工具卡片。

## 1. 我们已经做出了什么

这是一个辅助 LeetCode 刷题的学习 Agent。用户可以通过终端或 HTTP 接口发起多轮交互。模型需要外部信息时，可以请求本地程序查询时间、搜索笔记；程序将工具结果交还模型，由模型组织回答。成功的一轮问答保存在 JSON 文件中。

目前两个入口的显示方式不同：

- 终端：模型生成一段，就显示一段；工具执行完后显示工具记录。
- HTTP：`POST /api/agent/run` 返回完整 JSON，`POST /api/agent/stream` 增量返回事件。

网页使用 `POST /api/agent/stream` 接收流式文本与工具事件。

```mermaid
flowchart TD
    CLI["main.ts：终端输入"] --> SERVICE["service.ts：交互业务"]
    HTTP["express-server.ts → express-app.ts：HTTP 请求"] --> SERVICE
    SERVICE --> LOAD["session.ts：读取会话"]
    SERVICE --> MODEL["model.ts：模型请求与 Agent 循环"]
    MODEL --> API["外部模型 API"]
    API --> MODEL
    MODEL --> REGISTRY["tool-registry.ts：查找与执行工具"]
    REGISTRY --> TOOL["tool.ts：时间查询 / 搜索 notes"]
    TOOL --> REGISTRY
    REGISTRY --> MODEL
    MODEL --> SERVICE
    SERVICE --> SAVE["session.ts：保存完整问答"]
```

## 2. 每个文件负责什么

| 文件 | 主要职责 | 重点函数或类型 |
| --- | --- | --- |
| [src/cli/main.ts](./src/cli/main.ts) | 读取键盘输入、处理终端命令、打印流式内容 | `main` |
| [src/archive/server.ts](./src/archive/server.ts) | 创建 HTTP 服务并监听端口 | `createApiServer` 的调用、`listen` |
| [src/archive/http-server.ts](./src/archive/http-server.ts) | 路由、正文解析、HTTP 响应和错误转换 | `createApiServer`、`handle`、`readJsonBody`、`sendJson` |
| [src/agent/service.ts](./src/agent/service.ts) | 创建/读取会话、组织一轮交互、并发控制 | `createAgentService`、`run` |
| [src/agent/runner.ts](./src/agent/runner.ts) | 调用模型、消费流、处理工具调用循环 | `requestModel` |
| [src/tools/registry.ts](./src/tools/registry.ts) | 根据名字分派工具，统一封装执行结果 | `createToolRegistry`、`executeTool` |
| [src/tools/index.ts](./src/tools/index.ts) | 工具描述、参数校验、时间和搜索实现 | `registeredTools` |
| [src/storage/conversations.ts](./src/storage/conversations.ts) | 会话结构验证、磁盘读取与保存 | `loadConversation`、`saveConversation` |
| [src/agent/messages.ts](./src/agent/messages.ts) | 消息类型与早期练习的数组辅助函数 | `Message`、`formatMessages` |
| [src/shared/errors.ts](./src/shared/errors.ts) | 带状态码和业务错误码的异常 | `AppError` |

`src/archive/` 保存早期练习和原生 HTTP 服务，不在当前 Express 交互调用链中。`server.ts` 前面保留的注释也是旧练习，实际执行的是文件底部的启动代码。

## 3. 先理解程序传递的数据

`messages.ts` 定义一条消息：

```ts
type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};
```

对应你熟悉的 Python，可以想成一个包含 `role` 和 `content` 的字典。不过 TypeScript 类型只在检查代码时提供约束，不会自动验证外部 JSON。

`src/storage/conversations.ts` 定义一个会话：

```ts
type Conversation = {
    id: string;
    title: string;
    messages: Message[];
};
```

例如：

```json
{
  "id": "example-session",
  "title": "什么是 Promise",
  "messages": [
    { "role": "user", "content": "什么是 Promise？" },
    { "role": "assistant", "content": "Promise 表示一个异步操作的最终结果。" }
  ]
}
```

`conversationId` 决定读取哪个历史文件；`messages` 给模型提供上下文。模型不会仅凭本地会话 ID 就自动知道以前说过什么。

## 4. 入口一：终端如何启动和交互

对应 [main.ts](./src/cli/main.ts)。

从项目根目录启动：

```bash
node --env-file=.env src/cli/main.ts
```

`.env` 需要配置 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL`，不要把密钥提交到仓库。

`main()` 首先创建一个交互服务：

```ts
const service = createAgentService();
```

随后确定当前会话：

1. 有命令行参数：通过 `service.getConversation(requestedId)` 读取指定会话。
2. 没有参数：通过 `loadLastConversation()` 读取最近会话。
3. 首次运行没有最近会话指针时，创建一个新会话对象。
4. `await saveConversation(conversation)` 保存当前会话并更新最近会话指针，然后才开始交互。

可以这样恢复指定会话：

```bash
node --env-file=.env src/cli/main.ts <会话ID>
```

`createInterface` 连接标准输入和输出，`terminal.question()` 返回 Promise。`await` 等待输入时暂停当前异步函数，Node 仍可以处理其他事件。

循环先处理特殊命令：

| 输入 | 行为 |
| --- | --- |
| 空字符串 | 跳过 |
| `/exit` | 跳出循环 |
| `/history` | 重新从磁盘读取当前会话，再格式化显示 |
| `/new` | 通过 service 创建并保存新会话，成功后切换 |
| 其他文字 | 当作普通交互消息 |

普通消息传给：

```ts
const result = await service.run(conversation.id, input, {
    onChunk: (text) => { stdout.write(text); },
    onTool: (name, argumentsJson, output) => {
        // 实际代码在这里打印工具名称、参数和结果。
    }
});
conversation = result.conversation;
```

这里两个回调是终端传给业务层的“显示动作”。业务层知道何时有文本和工具结果，但不需要自己读取键盘或操作 `stdout`。这样 HTTP 才能复用同一套业务逻辑。

即使失败，内层 `finally` 也会补换行；退出循环时，外层 `finally` 关闭终端接口。交互成功时已经保存，退出时不需要再次保存旧内存对象。

## 5. 入口二：HTTP 请求如何进入应用

对应 [server.ts](./src/archive/server.ts) 和 [http-server.ts](./src/archive/http-server.ts)。

```bash
node --env-file=.env src/archive/server.ts
```

`server.ts` 调用 `createApiServer()` 得到服务器对象，然后监听 `127.0.0.1:3000`。构造服务器和监听端口分开，方便测试时传入模拟服务或使用其他端口。

`createApiServer()` 默认创建一个交互服务实例。所有到达这个服务器的请求共用它，尤其共用它内部的忙碌集合。

每来一个请求，Node 调用 `createServer` 的回调，传入：

- `req`：请求方法、URL、headers，以及逐块到达的正文。
- `res`：用于设置状态码、响应头和返回内容的对象。

回调启动 `handle(req, res)`，并为它的 Promise 安装 `.catch(...)`。前面的 `void` 表示这里不使用 Promise 返回值；真正处理异步错误的是 `.catch`。

### 5.1 路由选择

`handle` 先取出 URL 的 `pathname`，再依次匹配路径。匹配成功的分支处理完后 `return`，不再执行后面的 404。

| 方法和路径 | 请求内容 | 成功响应 |
| --- | --- | --- |
| `GET /health` | 无 | 200，`{ status: "ok" }` |
| `GET /api/info` | 无 | 200，名称与版本 |
| `POST /api/echo` | `{ message }` | 200，`{ received }` |
| `POST /api/conversations` | `{}` 或 `{ title }` | 201，会话对象 |
| `GET /api/conversations/:id` | URL 中的会话 ID | 200，会话对象及历史 |
| `POST /api/agent/run` | `{ conversationId, message }` | 200，`{ conversationId, reply }` |

已知路径使用错误方法返回 405，并设置 `Allow`。不存在的路径返回 404。`/api/conversations/:id` 使用正则提取 ID，再用 `decodeURIComponent` 解码，编码非法时返回 400。

### 5.2 正文从字节变成对象

`readJsonBody(req)` 做四件事：

1. 检查媒体类型是 `application/json`，允许附带 `charset`；否则 415。
2. 用 `for await` 读取请求正文的各个 Buffer 块。
3. 累加实际字节数，超过 `64 * 1024` 返回 413，不只信任请求头声明的大小。
4. 合并 Buffer、按 UTF-8 解码，再 `JSON.parse`；解析失败返回 400。

先合并 Buffer 再解码，可以处理一个中文字的 UTF-8 字节被拆到不同块里的情况。正文大小限制按字节计算，和字符串的 `.length` 不同。

读取使用 `req.iterator({ destroyOnReturn: false })`。超限时 `req.resume()` 让剩余正文被消费，随后抛错，避免迭代提前退出立即销毁流，妨碍返回错误响应。

函数返回 `unknown`，因为合法 JSON 也可能是数字、数组或 `null`。路由还需要验证它是对象、字段存在且类型正确；service 再验证标题、消息长度和会话 ID 等业务规则。

## 6. 两个入口汇合：一轮交互的业务流程

对应 [service.ts](./src/agent/service.ts) 的 `createAgentService()`。

它返回三个函数：

```ts
return { newConversation, getConversation, run };
```

这些函数通过闭包共享 `directory`、`runModel` 和 `busy`。可以把它理解为：工厂函数创建了一组操作，以及这些操作共同使用的内部状态。

`newConversation` 验证标题、生成 UUID、保存空会话；`getConversation` 验证 ID 并读取文件。缺失文件转换成 404，损坏文件等读取错误转换成 500。

`run(conversationId, message, callbacks)` 的执行顺序如下：

1. **校验消息。** 必须是字符串，trim 后长度为 1～10000。这里的长度使用 JavaScript 字符串 `.length`。
2. **检查并加锁。** `busy.has(id)` 为真则抛 409，否则立即 `busy.add(id)`。
3. **读取最新历史。** 调用 `getConversation`，不依赖调用者缓存的旧对象。
4. **构造模型输入。** 创建用户消息，并 `structuredClone([...conversation.messages, userMessage])` 得到独立输入。
5. **等待模型。** 调用 `runModel`，把文本和工具回调传下去。
6. **检查成功结果。** 模型调用失败或返回空白文本，抛 502，不保存这一轮。
7. **追加完整问答。** 将 user 和 assistant 两条消息加入会话。标题仍为“新会话”时，取本次问题前 30 个字符串单位作为标题。
8. **等待保存。** 保存失败抛 500，不能向调用者报告交互已成功保存。
9. **返回结果。** 返回 `{ conversationId, reply, conversation }`。
10. **释放锁。** 无论成功或失败，`finally` 中都会 `busy.delete(id)`。

第 4 步只构造输入，还没有把用户问题保存到磁盘。这样模型失败时，历史不会多出一个没有有效回答的半轮消息。

### 6.1 并发保护为什么有效

假设同一会话的请求 A 和 B 同时到达：

```text
A：检查 busy → 加入 busy → await 读取文件
B：检查 busy → 已存在 → 返回 409
A：生成 → 保存 → finally 移除 busy
```

检查和加入之间没有 `await`，在当前 Node 执行流程中，这段同步代码不会在中途让出执行权。不同会话的 ID 不同，可以同时进行。

这是一种拒绝冲突请求的机制，不会自动排队。集合只属于一个服务实例：不同进程、不同实例，或者同时运行的 CLI 和 HTTP，不能靠它互相协调。

### 6.2 为什么模型是延迟导入的

默认 `runModel` 在真正交互时才执行：

```ts
const { requestModel } = await import('./runner.ts');
```

因此创建会话、查看历史和健康检查不需要先初始化模型客户端。测试也可以传入 `runModel` 和临时 `directory`，模拟模型并隔离数据，不使用真实密钥或历史。

## 7. 模型如何流式返回内容

对应 [runner.ts](./src/agent/runner.ts)。

模块首次加载时读取 `DEEPSEEK_API_KEY`，创建 OpenAI SDK 客户端，配置当前代码使用的 DeepSeek 地址、60 秒超时及 `maxRetries: 0`。`requestModel` 每次调用还会读取 `DEEPSEEK_MODEL`。

这些是本项目当前代码配置；本文没有独立验证供应商接口的最新兼容性。

`requestModel` 把历史转成 `ResponseInput`，随后最多进行 5 次模型请求。每次发送：

- 模型名称和完整的当前输入。
- 工具描述列表 `toolDefinitions`。
- 关于时间查询、搜索笔记、引用来源和工具文本处理的 instructions。
- `tool_choice: 'auto'`、`stream: true`。
- 当前代码配置的 `max_output_tokens: 512` 和 `reasoning: { effort: 'none' }`。

`client.responses.create(...)` 返回异步事件流，程序用 `for await` 消费。

| 事件 | 本地处理 |
| --- | --- |
| `response.output_text.delta` | 将片段追加到 `content`，并调用 `onChunk` |
| `response.completed` | 保存完整 response，后面检查它的 output |
| `response.incomplete` | 抛错，不保存不完整回答 |
| `response.failed` 或 `error` | 抛错 |
| 流结束但没收到 completed | 视为连接提前结束，抛错 |

`onChunk?.(event.delta)` 中的 `?.` 表示回调存在才调用。CLI 提供回调，HTTP 当前没有提供。

`content` 放在循环外，因此会累积本轮所有模型请求的文本片段，最终保存的可能包括工具调用前后的文字。工具执行结果本身不会直接作为交互正文追加，模型会根据它生成文本。

## 8. 工具调用：模型提出请求，程序执行函数

流完整结束后，程序从 `completedResponse.output` 筛选 `function_call`。

如果没有工具调用：检查累积文本非空，返回 `content`，交给 service 保存。

如果有工具调用，流程如下：

```text
模型：请求 search_practice_notes，arguments = {"query":"二分"}
  ↓
程序：executeTool("search_practice_notes", arguments)
  ↓
本地：检索刷题笔记 JSON，返回题目信息、摘要和 ID
  ↓
程序：追加 function_call_output，绑定原来的 call_id
  ↓
再次请求模型：带上历史、本次模型输出、工具结果
  ↓
模型：根据检索片段组织回答
```

发给模型的工具描述不是函数源码。模型只返回“调用什么、参数是什么”；真正的文件读取、时间查询发生在本机。

### 8.1 为什么要带回完整 output 和 call_id

程序先将模型的 message、reasoning、function_call 输出项追加到当前 `input`，随后为每个工具追加：

```ts
{
    type: 'function_call_output',
    call_id: call.call_id,
    output
}
```

`call_id` 把结果和某一次调用对应起来。仅有工具名称不够，因为同一工具可能被调用多次。

当前实现每次重新发送累积输入，不使用 `previous_response_id`。遇到未支持的 output 类型会抛错，不静默丢弃。

多个工具按 `for...of` 顺序执行，每个执行完后调用 `onTool`。现在的工具回调表示“执行结束”，没有单独的开始事件。

最多 5 次限制的是本轮模型请求数，不是工具总数。第五次仍要求工具时，程序直接报错，不再执行工具，因为已没有下一次模型请求来处理结果。

### 8.2 注册表怎样代替大量 if

对应 [tool-registry.ts](./src/tools/registry.ts) 和 `src/tools/index.ts` 的 `registeredTools`。

每个工具包含：

```ts
{
    definition: /* 给模型看的名称、描述和参数结构 */,
    execute: /* 本地真正执行的函数 */
}
```

注册时用 Map 保存 `name → tool`，名称重复立即报错。执行时统一走：

```text
查找名称 → JSON.parse(arguments) → 工具自己的参数校验
        → await tool.execute(args) → JSON.stringify(结果)
```

成功输出带 `ok: true`；未知工具、坏 JSON、参数错误或执行失败，统一变成 `{ ok: false, error: ... }` 的 JSON 字符串。

工具失败通常不会立刻终止整轮交互：错误结果会送给模型，让它修正参数或解释失败。模型接口本身失败则由外层转换成 502。

新增工具时，在列表加入描述和执行函数即可，不需要修改通用分派器。

## 9. 当前两个工具具体做什么

对应 [tool.ts](./src/tools/index.ts)。

### 时间工具

`get_current_time` 需要一个非空字符串 `timezone`。本地使用 `Intl.DateTimeFormat` 按时区格式化本机当前时间。时区无效时抛错，再由注册表转换成失败结果。

### 刷题笔记工具

保存、搜索、读取、修改均复用结构化 JSON 存储。搜索支持关键词、题号和标签，返回摘要和 ID；完整内容通过读取工具获取。详细参数及流程见第 20 节。

## 10. 会话怎样持久化和恢复

对应 [session.ts](./src/storage/conversations.ts)。

默认路径通过 `new URL('../data/', import.meta.url)` 定位到代码旁的目录，不随启动命令的工作目录随意变化。

```text
data/
├── conversation_<id>.json
└── last-session.txt
```

`conversation_<id>.json` 保存完整会话；`last-session.txt` 保存最近一次成功更新指针的会话 ID，供 CLI 恢复使用。

读取流程：

```text
验证 ID → readFile → JSON.parse
       → validateConversation 验证结构 → 返回会话
```

`validateConversation` 不只检查 JSON 是否能解析，还检查 ID 与目标一致、标题是字符串、消息数组中的 role/content 合法。TypeScript 类型不能代替这一步运行时校验。

最近会话指针不存在时才自动创建新会话；已有指针指向缺失文件、文件损坏等情况继续报错，避免误当空历史。

保存流程：

```text
验证 ID 和会话结构
  → 创建目录
  → 会话 JSON 写到随机临时文件
  → rename 替换正式会话文件
  → 同样方式更新 last-session.txt
```

`finally` 尝试清理临时文件。先写临时文件再替换，减少直接覆盖时留下半段 JSON 的风险。

两个文件不是一个事务：可能会话已经替换成功，但最近会话指针更新失败。因此 service 的保存错误提示要求读取历史确认状态，不能简单宣称“报错就完全没保存”。这套实现也没有提供数据库事务或断电持久性保证。

跨轮保存的只有用户消息和助手正文。本轮内部的工具调用、工具结果和 reasoning 没有写入会话文件。

## 11. 成功和失败最后怎样返回给用户

成功时，`requestModel` 返回文本，service 保存会话后返回 `AgentResult`：

- CLI 更新当前会话变量；文本此前已经通过回调逐段显示。
- HTTP 取出 `conversationId` 和 `reply`，通过 `sendJson` 返回 200。

`sendJson` 设置 JSON UTF-8 响应头并结束响应；如果连接已经销毁或响应已结束，就不再写入。

HTTP 入口统一捕获异常：

| 状态码 | 当前典型情况 |
| --- | --- |
| 400 | JSON、字段、会话 ID 或消息内容不合法 |
| 404 | 路由或会话不存在 |
| 405 | 方法不支持 |
| 409 | 同一服务实例内该会话正在交互 |
| 413 | 正文超过 64 KiB |
| 415 | 正文媒体类型不是 JSON |
| 500 | 文件读取、保存失败，或未分类内部异常 |
| 502 | 模型失败、流不完整、空回复或超过请求次数上限 |

`AppError` 保留预设的 status/code/message；其他异常对外统一返回 `INTERNAL_ERROR`，不直接暴露内部异常细节。

```json
{
  "error": {
    "code": "CONVERSATION_BUSY",
    "message": "当前会话正忙"
  }
}
```

终端已经展示部分文本后仍可能遇到流失败，此时会显示失败提示，但该轮不写入历史。显示过的文字和成功持久化的记录是两个不同阶段。

HTTP 客户端断开目前也不会自动取消模型任务。服务器设置了请求/请求头接收超时，但它们不能代替整个 Agent 生成流程的取消机制。

## 12. 用一个实际问题串起全部流程

假设已有会话 `id`，用户问：“找找我之前的二分笔记”

1. CLI 读取问题，或 HTTP 路由从 JSON 中取出 `conversationId` 和 `message`。
2. service 校验消息，标记会话忙碌，读取磁盘历史。
3. service 构造“旧历史 + 当前问题”，调用模型。
4. 模型可能请求 `search_practice_notes`，参数为 `{"query":"二分"}`。
5. 注册表查到工具、解析参数并执行，搜索本地刷题笔记。
6. 程序把原始模型输出与对应的工具结果追加到本轮输入。
7. 再次请求模型，模型依据摘要回答，需要完整内容时再调用 get_practice_note，并注明笔记 ID。
8. CLI 通过回调逐段显示；HTTP 此时仍等待。
9. 模型完整结束且有有效文本，service 追加一轮问答、保存、释放忙碌标记。
10. CLI 更新会话对象；HTTP 返回完整 JSON。
11. 用户继续追问时，再从保存的历史开始下一轮。

步骤 4 的调用选择由模型决定，不是固定规则分支；示例说明一条预期路径，不能保证每次生成完全相同。

## 13. 怎样验证当前实现

从项目根目录运行：

```bash
npm run typecheck
node --test test/*.test.mjs
```

本次整理时两条命令通过，测试运行器报告 3 个测试文件通过。

| 已保存的测试文件 | 主要验证内容 |
| --- | --- |
| `test/agent.test.mjs` | 模拟模型流、普通回答、工具调用、参数修正、轮数上限及异常 |
| `test/tool-registry.test.mjs` | 同步/异步工具分派、不同参数结构、重复工具名 |
| `test/session.test.mjs` | 会话保存加载、切换、损坏数据及写入失败 |

此前还做过临时的 service 并发/失败验证、正文解析和模拟路由检查；这些不是已经保存进测试目录的长期回归测试。用户已通过 curl 验证交互及历史。最近路由修改的验证是模拟请求，因环境不允许监听端口，没有重新做真实 HTTP 网络验证。

测试中的模拟模型不等同于真实供应商接口验证，也不需要调用付费模型。

## 14. 后续从哪里接着做

第一阶段的后端已经完成。下一步是第二阶段的第一个小练习：

```text
HTML 输入框 → 点击按钮 → 浏览器 fetch /api/echo → 页面展示返回值
```

之后将 echo 换成创建会话和交互接口，再添加消息列表、等待状态、错误提示、流式文本与工具事件、会话恢复、取消生成。

这些新入口可以继续使用 `src/agent/service.ts`。它不依赖终端显示方式，这正是我们先抽出共享业务层的实际收益。


## 15. 当前网页入口（2026-10-21）

前端由助手实现，用户后续重点学习后端。`public/index.html` 提供侧栏会话列表、消息区域和输入框，`style.css` 负责响应式布局，`app.js` 负责浏览器状态与 API 调用。

1. 启动页面时读取 localStorage 中的最近会话 ID，通过 GET 接口加载服务器历史。浏览器只存列表和选择状态，不保存密钥。
2. 首次发送时先 POST 创建会话，再 POST 交互；也可以点击新建、选择列表中的会话或粘贴 ID 打开。
3. 生成期间锁定发送和会话切换，显示等待状态；后端成功返回后显示完整回复。
4. 失败时保留输入，重新读取服务器历史核对保存结果；历史也无法读取时，先要求刷新再发送，不自动重试模型请求。
5. 最近列表只记录当前浏览器访问过的最多 50 个会话，不代表服务器全部会话。
6. 助手正文使用 Marked 解析 Markdown，再经 DOMPurify 标签/属性白名单清理后显示；用户消息仍用 textContent。支持标题、列表、引用、表格及代码块，代码块暂未做语法高亮。Enter 发送，Shift+Enter 换行，输入法组合期间不触发发送。

验证：`node --test test/*.test.mjs`，其中 HTTP 测试需要本机监听端口权限。新增 frontend.test.mjs 使用最小 DOM 替身验证发送、重复提交保护、刷新恢复、失败保留输入、切换与文本显示。未进行真实浏览器视觉验证，也未通过测试调用真实模型。流式事件、工具面板和取消请求仍待实现。


## 16. 沙箱接入 HTTP 与 Agent

两条入口共享同进程的 `sandboxService`：

```text
POST /api/sandbox/run → sandbox-service.ts → sandbox.ts → Docker
模型 run_python 调用 → tool.ts 注册表 → sandbox-tool.ts ↗
```

- `src/sandbox/service.ts` 校验参数、合计限制一个执行任务；超额返回 429。清理完成才释放名额，清理失败或执行器意外抛错后停止接单，检查残留容器并重启服务后恢复。
- HTTP 请求为 `{ "code": "print(1 + 2)", "stdin": "" }`。只有 Python；不接受自定义镜像、路径或限制字段。
- 正常退出、程序报错、超时、输出超限返回 HTTP 200 的执行结果；Docker 基础设施或清理故障返回 HTTP 503 的执行结果。参数错误返回 400 的统一 error 对象，忙碌返回 429。
- 工具结果的 `ok: true` 表示工具成功返回结构化结果。必须另看 `executionSucceeded`、`status` 和 `exitCode`，它们不代表算法通过官方测试。
- `runner.ts` 指示模型仅在用户要求运行/验证时执行 Python，显式包装 Solution 调用，不能擅改算法后声称原代码正确，也不能将 stdout/stderr 当成新指令。
- 本轮验证使用模拟执行器/模型和实际本机 HTTP，另用模拟 Docker 子进程验证正式 sandbox.ts。真实容器资源隔离仍需本机验收。
- 并发限制仅限一个 Node 进程，尚无跨进程协调、取消生成、进程崩溃后的残留清扫。保持服务绑定 127.0.0.1。

验证接口：

```bash
node --env-file=.env src/http/server.ts
```

另一个终端：

```bash
curl -i http://127.0.0.1:3001/api/sandbox/run \
  -H 'Content-Type: application/json' \
  -d '{"code":"name = input()\nprint(\"你好，\" + name)","stdin":"小明\n"}'
```

网页输入“请运行 Python 的 print(1 + 2)，根据实际结果告诉我输出”，即可通过 Agent 调用同一个沙箱。当前网页显示模型最终解释，工具结果仍通过现有 Agent 回调回传，尚无网页工具轨迹面板。


## 17. 网页流式输出与工具卡片

网页改用 `POST /api/agent/stream`，请求仍为 `{ conversationId, message }`。响应采用 NDJSON：每行一个 JSON 事件。

- `delta`：模型文字片段，浏览器累积正文并每约 40 毫秒更新一次经 DOMPurify 清理的 Markdown。
- `tool`：工具执行结束后包含 name、argumentsJson、output，网页展示可展开的参数与结果卡片。Python 工具区分协议成功与程序执行成功。
- `done`：只有 AgentService 完成保存后才发送，包含 conversationId、reply、title；浏览器据此确认已保存并用最终正文校正显示。
- `error`：已开始发送时的错误事件，包含 code 和 message；还没发送任何片段时沿用 HTTP 错误状态及 JSON。

浏览器用 TextDecoder 流式解码，并保留未完成的 JSON 行，处理中文字符及事件跨网络块的情况。没有 done 就结束视为异常，保留输入并重新查询历史，不自动重复发送。工具卡片只保留本轮，刷新或切换会话后清空。当前没有取消执行；连接断开后后端可能继续生成并保存，需刷新历史确认。

`test/stream.test.mjs` 验证先收到片段再完成、工具事件、保存后 done、并发冲突和失败不保存；`test/frontend-stream.test.mjs` 验证逐字节分包、正文中途显示、工具内容不执行 HTML 和断流状态。没有通过测试调用付费模型。


## 18. 工具文件组织

- `src/tools/implementations.ts`：统一放置时间、笔记搜索、Python 工具的描述与执行逻辑，导出三个 `create…Tool()` 工厂，均返回 `RegisteredTool`。Python 的 Docker 执行继续复用 sandbox 服务。
- `src/tools/index.ts`：唯一注册清单；创建工具对象并传给注册表，向 Agent 导出 toolDefinitions 和 executeTool。
- `src/tools/registry.ts`：通用名称查找、JSON 参数解析、成功/错误封装，不包含具体工具实现。
- `RegisteredTool` 类型放在 `registry.ts`；共用校验辅助函数放在 `implementations.ts`，不另拆小文件。

新增工具：在 implementations.ts 增加工厂，再在 index.ts 注册，不修改 registry.ts。


## 18. 取消 Agent 执行

网页执行期间显示“停止”。`public/app.js` 使用 AbortController 中止流式 fetch，保留已收到的部分文本并标记未完成，同时读取历史核对是否已保存。

`src/http/app.ts` 监听响应连接的 `close` 事件；只有响应尚未正常结束时才取消本轮信号。信号通过 service 的 callbacks 传给 runner，runner 将信号传入 SDK 请求和工具注册表。工具执行前后检查取消状态，取消不会被转换成普通工具错误再交给模型重试。

Python 工具把同一个信号传入沙箱。运行阶段取消会停止 Docker 客户端，再通过独立的 `docker rm --force` 终止并删除容器；创建阶段先等待创建命令结束再清理，避免清理早于创建。清理有独立超时，完成前保留沙箱名额，清理失败保持闭锁。

service 在保存前检查取消；若已开始写盘，则等待写盘完成。取消不能撤销已完成的工具副作用。网页核对历史时若保存仍在进行，会提示稍后刷新；立即重试也可能因后端仍在清理返回忙碌。目前取消操作接在网页流式入口，CLI 和非流式 HTTP 入口未接入。


## 19. 工具调用历史

service 收集 onTool 回调中的 name 和 argumentsJson，成功保存时附加到本轮助手消息的 toolCalls 数组。工具输出不落盘。流式 done 事件携带这些记录，网页即时展示并在重新读取会话后恢复。旧消息没有 toolCalls 也可读取。构造模型输入时仅选择 role/content，历史调用元数据不参与模型协议。当前只保存成功轮次中已返回的工具调用，取消或失败轮次不会保存；这不是独立的执行审计日志。


## 20. 刷题笔记工具

四个工具均在 src/tools/implementations.ts 实现，在 src/tools/index.ts 注册，工具分派器无需改动。

- save_practice_note({ note })：保存 problem、original、summary 三部分，返回后端生成的 ID 和时间。
- search_practice_notes({ query?, number?, tag?, limit? })：可组合筛选；空对象列出最近笔记，返回 ID、题目信息、标签和最多 300 字的思路摘要。默认 10 条，最多 20 条；关键词不区分英文大小写，标签完整匹配，条件取交集。
- get_practice_note({ id })：读取完整笔记，ID 必须来自真实结果。
- update_practice_note({ id, note })：完整替换内容，保留 ID 和创建时间；修改前先读取，沿用未修改字段。

流程示例：“把这题记下来” → 保存 → 返回 ID；“找我的哈希表笔记” → 搜索 → 读取 → 引用原文；“修改这篇的易错点” → 读取 → 完整更新。笔记输入复用存储层校验，失败返回工具错误，不能宣称写入成功。缺失目录按空集合处理，损坏笔记报错，不伪装成没有结果。写入开始后取消不撤销已完成的保存，当前也没有幂等去重或跨会话并发编辑冲突检测。

笔记删除与导出：新增 delete_practice_note({ id }) 和 export_practice_note_markdown({ id })。删除仅针对明确指定的笔记，文件不存在时报错；导出为 data/exports/ 下独立 Markdown 快照，包含题目信息、原始思路/代码/题解、整理内容和时间，返回本机路径，尚无网页下载接口。导出文件不会因删除原笔记而删除；已完成的删除无法通过取消生成撤销。
