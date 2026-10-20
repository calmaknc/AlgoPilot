# HTTP 与 JSON

## 请求的组成

HTTP 请求包含方法、URL、请求头，以及可选的正文。GET 常用于获取资源，POST 常用于提交数据或创建资源。实际支持哪些操作由服务端接口定义。

例如 GET /posts/1 表示查询某篇文章，POST /posts 表示创建文章。修改方法后，不能假设原路径一定支持新操作。

## 状态码

- 200：请求成功。
- 201：创建成功。
- 400：请求存在问题。
- 401：请求未通过认证。
- 404：请求的资源未找到。
- 500：服务器内部错误。

## fetch 的错误处理

fetch 收到 404 或 500 响应时通常不会自动抛错，需要检查 response.ok。response.ok 表示状态码是否处于 200 到 299。

网络连接失败可能使 fetch 返回的 Promise 失败。response.json() 读取正文并解析 JSON，也可能失败，例如正文不是有效 JSON。

## JSON 与 JavaScript 对象

JSON 是文本格式，JavaScript 对象是运行时数据。JSON.stringify() 将数据序列化为字符串，JSON.parse() 将 JSON 文本解析为数据。

发送 JSON 请求时，通常使用 Content-Type: application/json，并用 JSON.stringify() 构造正文。

## 环境变量与密钥

Node.js 通过 process.env 读取环境变量。密钥应保存在本地环境配置中，不应硬编码进源码或提交到 Git。

项目运行命令中的 `--env-file=.env` 用来加载配置文件；仅创建 .env 文件不会自动加载它。
