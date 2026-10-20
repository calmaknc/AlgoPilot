# 异步与 Promise

## 异步解决的问题

网络请求、文件读取等操作需要等待。异步机制允许当前函数等待结果时，让运行环境处理其他工作。async 不会自动创建线程，也不会让 CPU 密集计算自动并行。

## Promise 的状态

Promise 表示未来的结果，状态包括 pending、fulfilled 和 rejected。成功后携带结果，失败后携带失败原因。一旦确定结果，状态不会再次改变。

## async 和 await

async 函数总是返回 Promise。函数中返回普通字符串，调用者得到的是 Promise<string>。

await 暂停当前异步函数的后续执行。Promise 成功后，函数恢复并获得结果；Promise 失败时，在 await 位置表现为抛出异常。

```ts
async function readAnswer(): Promise<string> {
  return '你好';
}

const answer = await readAnswer();
```

## resolve 与事件循环

resolve 是创建 Promise 时得到的函数，用于提交结果。如果提交的是另一个 Promise，外层 Promise 会跟随它的结果。

运行环境负责等待 I/O，完成后通知相关处理逻辑。Promise 的后续处理通过微任务调度，不会打断当前正在执行的同步代码。

## 异步错误处理

在 try 中 await 一个异步操作，可以在 catch 中捕获它的失败。finally 适合释放资源，例如关闭终端输入接口。

## 异步迭代

`for await...of` 用于逐个消费异步数据。例如读取模型流式回复时，每收到一个事件，就执行一次循环体。流式输出的分段不保证对应一个字或一个 token。
