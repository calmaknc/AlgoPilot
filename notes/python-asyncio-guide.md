# Python 异步编程：从零入门到实际使用

这份教程接着我们之前的 Python 示例，集中讲清楚异步的执行方式、结果收集、异常、超时、取消和并发限制。示例以 Python 3.11 及以上版本为准，除特别说明外，每个完整代码块都可以单独保存为 `.py` 文件运行。

当前项目也有 TypeScript 的异步笔记 `notes/async.md`。两种语言的 `async/await` 外观相似，但启动行为不同，文末会说明，避免混用。

## 1. 异步解决什么问题？

程序中的工作可以粗略分为两类：

- **计算**：做数学运算、处理图片、运行大量循环。
- **等待**：等网络响应、数据库结果、定时器到期。

异步的主要价值是：一个任务等待时，让其他任务有机会继续推进。

比如烧水需要 2 分钟，整理桌子需要 1 分钟。你可以开始烧水，然后利用等待时间整理桌子。烧水速度没变，但两件事情的总耗时减少了。

| 概念 | 含义 |
| --- | --- |
| 顺序执行 | 一件事完成后再开始下一件事 |
| 并发 | 多件事在同一段时间内交替推进 |
| 并行 | 多件事在同一时刻执行，例如多个 CPU 核心分别计算 |
| 阻塞 | 当前线程被占住，无法继续执行其他代码 |

`asyncio` 通常在一个线程上通过事件循环调度多个任务。这里说的是“主协程和其他任务并发推进”，不是“主进程与新进程并行运行”。

## 2. 从一个可以运行的例子开始

```python
import asyncio
import time


async def task(name, seconds):
    print(f"{name} 开始")
    await asyncio.sleep(seconds)
    print(f"{name} 完成")
    return name


async def main():
    start = time.perf_counter()
    await task("A", 2)
    await task("B", 2)
    print(f"顺序执行：{time.perf_counter() - start:.1f} 秒")

    start = time.perf_counter()
    await asyncio.gather(task("A", 2), task("B", 2))
    print(f"并发执行：{time.perf_counter() - start:.1f} 秒")


asyncio.run(main())
```

保存为 `demo.py`，在终端执行：

```bash
python3 demo.py
```

第一部分约 4 秒，第二部分约 2 秒，整个脚本约 6 秒。

连续 `await` 的时间线：

```text
0 秒        2 秒        4 秒
A 等待 ------ 完成
             B 等待 ------ 完成
```

`gather` 的时间线：

```text
0 秒        2 秒
A 等待 ------ 完成
B 等待 ------ 完成
```

“耗时取决于最长任务”适用于这种几乎同时启动、等待可以重叠的例子。实际任务还会受到计算、资源争用、并发上限等因素影响。

## 3. 四个核心概念

### 3.1 `async def`：定义协程函数

```python
async def get_number():
    return 42
```

调用 `get_number()` 得到的是**协程对象**，不是数字 42，而且此时函数体还没有执行。

在异步函数内，可以通过下面的方式执行它并拿到结果：

```python
number = await get_number()
```

如果创建协程对象后既不等待也不调度，工作不会完成，通常还会出现 `coroutine was never awaited` 警告。

### 3.2 `await`：等待结果，必要时交出执行权

```python
result = await some_async_operation()
print(result)
```

当前协程必须获得结果后才能执行 `print`。等待期间，事件循环可以运行其他已安排的任务。

但 `await` 不保证一定切换任务：如果结果已经就绪，或者所调用的协程一路运行而没有真正暂停，就可能直接继续。

`await` 后面必须是可等待对象，例如协程或 Task；不能随便写 `await 123`。

### 3.3 Task：已经安排执行的协程

```python
task = asyncio.create_task(get_number())
number = await task
```

`create_task` 把协程交给事件循环调度，并立即返回 Task。默认调度方式下，当前协程交出执行权后，新任务才有机会运行。

Task 保存运行状态、结果或异常。等待已经完成的 Task 会直接取得结果，不会重新执行原来的函数。

### 3.4 事件循环：调度任务

事件循环负责运行就绪的任务、关注 I/O 和定时器，并在等待条件满足时恢复相应任务。

同一事件循环线程内，一个任务执行普通 Python 代码时，其他任务不会自动抢走执行权。因此长时间的同步计算或阻塞操作会影响所有任务。

`asyncio.run(main())` 用来启动事件循环并运行入口，通常放在脚本最外层。不要在已经运行的事件循环中再次调用它。在支持顶层 `await` 的 Notebook 中，通常直接写 `await main()`。

## 4. `create_task`：先安排任务，稍后等待

```python
import asyncio


async def boil_water():
    print("开始烧水")
    await asyncio.sleep(2)
    print("水烧好了")
    return "热水"


async def main():
    water_task = asyncio.create_task(boil_water())

    print("开始整理桌子")
    await asyncio.sleep(3)
    print("桌子整理好了")

    water = await water_task
    print(f"用{water}泡茶")


asyncio.run(main())
```

总耗时约 3 秒。到 `await water_task` 时，烧水已经完成，因此不用额外等。

如果把整理桌子的 `await asyncio.sleep(3)` 换成 `time.sleep(3)`，默认调度下总耗时会变成约 5 秒：前 3 秒事件循环被阻塞，烧水任务还没有机会开始。

要保存创建的 Task，并明确在什么地方等待它、处理异常或取消它。主协程退出后，`asyncio.run` 会取消剩余未完成任务，不会因为你调用了 `create_task` 就一直在后台执行它们。

## 5. `gather`：一起执行，按传入顺序收集结果

```python
import asyncio


async def fetch_price(name, seconds, price):
    await asyncio.sleep(seconds)
    print(f"{name}查询完成")
    return price


async def main():
    prices = await asyncio.gather(
        fetch_price("苹果", 2, 10),
        fetch_price("香蕉", 1, 6),
        fetch_price("橙子", 3, 8),
    )
    print(prices)  # [10, 6, 8]


asyncio.run(main())
```

香蕉最先完成，但结果仍然按苹果、香蕉、橙子的传入顺序排列。`gather` 可以直接接收协程，不必先逐个调用 `create_task`。

如果有一个协程列表，可以使用 `await asyncio.gather(*coroutines)`。这里 `*` 将列表展开为多个位置参数。

## 6. `as_completed`：谁先完成，先处理谁

```python
import asyncio


async def fetch_price(name, seconds, price):
    await asyncio.sleep(seconds)
    return name, price


async def main():
    tasks = [
        asyncio.create_task(fetch_price("苹果", 2, 10)),
        asyncio.create_task(fetch_price("香蕉", 1, 6)),
        asyncio.create_task(fetch_price("橙子", 3, 8)),
    ]

    for completed in asyncio.as_completed(tasks):
        name, price = await completed
        print(f"{name}：{price}")


asyncio.run(main())
```

约第 1 秒显示香蕉，第 2 秒显示苹果，第 3 秒显示橙子。循环里的 `await` 不会让查询变成顺序执行，因为这些任务已经提前安排好了。

如果改成 `for task in tasks: result = await task`，任务仍然并发执行，但结果会按列表顺序被读取，较慢的前项会延迟后项的显示。

## 7. 异常：失败也是任务结果的一部分

### 7.1 单个任务：在 `await` 处捕获

```python
try:
    result = await some_async_operation()
except ValueError as error:
    print(f"操作失败：{error}")
```

这一段是写法示意，需要将 `some_async_operation` 换成实际函数。

协程抛出的异常，会传到等待它的代码中。捕获具体异常更容易区分可恢复错误和代码缺陷。

### 7.2 独立任务：收集成功和失败

```python
import asyncio


async def fetch_price(name):
    await asyncio.sleep(1)
    if name == "香蕉":
        raise ValueError("价格查询失败")
    return 10


async def main():
    names = ["苹果", "香蕉", "橙子"]
    results = await asyncio.gather(
        *(fetch_price(name) for name in names),
        return_exceptions=True,
    )

    for name, result in zip(names, results):
        if isinstance(result, asyncio.CancelledError):
            print(f"{name}已取消")
        elif isinstance(result, Exception):
            print(f"{name}失败：{result}")
        else:
            print(f"{name}价格：{result}")


asyncio.run(main())
```

`return_exceptions=True` 会等待全部任务结束，将异常也放入结果列表。一个任务第 1 秒失败，另一个第 3 秒完成，整体仍要约 3 秒。

默认情况下，`gather` 会向调用方传播第一个异常，**不会因此自动取消其他子任务**。如果这个异常导致主协程退出，随后 `asyncio.run` 清理剩余任务，又可能造成其他任务被取消；这是两个不同阶段。

### 7.3 互相依赖的一组任务：`TaskGroup`

Python 3.11 起可以使用 `TaskGroup`。它适合“一组任务构成一个整体，一个失败就取消其余任务”的情况。

```python
import asyncio


async def work(name, fail=False):
    await asyncio.sleep(1)
    if fail:
        raise ValueError(f"{name}失败")
    return name


async def main():
    try:
        async with asyncio.TaskGroup() as group:
            a = group.create_task(work("A"))
            b = group.create_task(work("B", fail=True))
    except* ValueError as errors:
        for error in errors.exceptions:
            print(error)
    else:
        print(a.result(), b.result())


asyncio.run(main())
```

离开 `async with` 前，它会等待组内任务结束。某个任务出现普通异常时，它会取消尚未完成的其他任务，等待清理，再以异常组报告错误。`except*` 用于处理异常组，入门阶段先认识即可。单个任务被取消的情况与普通失败不同，不会自动触发同样的整组失败行为。

## 8. 超时：不要无限等待

```python
import asyncio


async def query():
    try:
        await asyncio.sleep(5)
        return 10
    finally:
        print("清理查询资源")


async def main():
    try:
        result = await asyncio.wait_for(query(), timeout=2)
        print(result)
    except TimeoutError:
        print("查询超时")


asyncio.run(main())
```

查询需要 5 秒，超时设为 2 秒，因此约第 2 秒触发取消并报超时。如果查询只需要 1 秒，就在约第 1 秒返回，不会等满 2 秒。

`wait_for` 会请求取消被等待的任务，并等待其取消完成，因此它不是严格的耗时硬上限。阻塞事件循环、耗时的清理，以及协程压制取消，都会影响实际行为。

Python 3.11 及以上也可以对一段代码设置总超时：

```python
try:
    async with asyncio.timeout(2):
        await step_one()
        await step_two()
except TimeoutError:
    print("两个步骤合计超时")
```

这是结构示意，`step_one` 和 `step_two` 需要自行定义。这里两个步骤共用 2 秒预算，不是各有 2 秒。

## 9. 取消：请求任务停止，并完成清理

```python
import asyncio


async def worker():
    try:
        while True:
            print("工作中")
            await asyncio.sleep(1)
    finally:
        print("释放资源")


async def main():
    task = asyncio.create_task(worker())
    await asyncio.sleep(2.5)

    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("任务已取消")


asyncio.run(main())
```

`task.cancel()` 是发出取消请求，不是强行杀死线程。取消通常在协程挂起或恢复的位置以 `CancelledError` 的形式体现。

取消后再 `await task`，可以等它完成退出和清理。`finally` 适合关闭连接、释放锁等工作。若在工作协程内部捕获 `CancelledError`，通常应在清理后用 `raise` 重新抛出，让上层知道任务确实被取消。

`CancelledError` 继承自 `BaseException`，不会被普通的 `except Exception` 捕获。

## 10. 信号量：限制同时进行的操作数量

```python
import asyncio


async def query(number, semaphore):
    async with semaphore:
        print(f"开始：{number}")
        await asyncio.sleep(2)
        print(f"完成：{number}")
        return number


async def main():
    semaphore = asyncio.Semaphore(3)
    results = await asyncio.gather(
        *(query(i, semaphore) for i in range(10))
    )
    print(results)


asyncio.run(main())
```

10 个任务，每个 2 秒，最多同时进行 3 个，需要约 8 秒：

```text
0～2 秒：3 个任务
2～4 秒：3 个任务
4～6 秒：3 个任务
6～8 秒：1 个任务
```

所有任务必须共用同一个信号量。`async with` 进入时获取名额，退出时归还；没有名额的任务暂停等待。

信号量限制的是代码块内的并发数量，不是每秒请求次数。如果每个请求只需要 0.1 秒，3 个并发也可能每秒发出很多次请求。

另外，信号量不会减少已创建的任务总数。数据达到几十万甚至更多时，应该考虑 `asyncio.Queue` 加固定数量的工作协程，持续取出工作，避免一次创建海量 Task。入门时先掌握信号量即可。

## 11. 同步代码怎么接入异步程序？

在协程里面直接调用同步阻塞函数，仍然会阻塞事件循环：

```python
async def bad_example():
    time.sleep(3)  # 外面加了 async，也不会变成非阻塞操作
```

如果暂时没有异步接口，可以用 `asyncio.to_thread` 将适合的同步阻塞工作放到线程中：

```python
import asyncio
import time


def blocking_read():
    time.sleep(2)
    return "读取完成"


async def main():
    result, _ = await asyncio.gather(
        asyncio.to_thread(blocking_read),
        asyncio.sleep(1),
    )
    print(result)


asyncio.run(main())
```

总耗时约 2 秒，等待同步读取期间，事件循环仍能处理其他任务。

适用对象包括同步文件操作、同步网络客户端等阻塞 I/O。对于大量纯 Python 计算，在常见启用 GIL 的 CPython 环境中，放到线程通常不能获得多核计算加速；此时应考虑进程池等方案。

还有一个实际区别：取消等待 `to_thread` 的任务，通常不会停止线程中已经运行的函数。因此阻塞网络调用自身也需要合理设置超时。

## 12. 一个真实网络请求例子

下面只使用标准库，把同步 HTTP 请求放入线程，让两个请求并发推进。它需要可用的网络；网络失败或被限制时会报告错误。

```python
import asyncio
import urllib.request


def read_page(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": "AsyncLearning/1.0"}
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        # 示例只读取前 1024 字节。
        return len(response.read(1024))


async def fetch(url, semaphore):
    async with semaphore:
        size = await asyncio.to_thread(read_page, url)
        return url, size


async def main():
    urls = ["https://example.com", "https://example.org"]
    semaphore = asyncio.Semaphore(2)
    results = await asyncio.gather(
        *(fetch(url, semaphore) for url in urls),
        return_exceptions=True,
    )
    for url, result in zip(urls, results):
        if isinstance(result, Exception):
            print(f"{url} 失败：{result}")
        else:
            _, size = result
            print(f"{url} 读取了 {size} 字节")


asyncio.run(main())
```

这展示了如何接入现有同步库。若项目使用原生异步 HTTP 客户端，通常直接 `await` 其请求接口，并复用客户端连接池，无须用线程包装。

## 13. 综合练习：限制并发、设置超时、收集失败

这个示例不需要网络，可以直接运行。

```python
import asyncio


async def fake_request(name, seconds, should_fail):
    await asyncio.sleep(seconds)
    if should_fail:
        raise ValueError("模拟服务端错误")
    return f"{name}的数据"


async def fetch_one(name, seconds, should_fail, semaphore):
    async with semaphore:
        try:
            data = await asyncio.wait_for(
                fake_request(name, seconds, should_fail),
                timeout=2,
            )
            return {"name": name, "status": "成功", "data": data}
        except TimeoutError:
            return {"name": name, "status": "超时"}
        except ValueError as error:
            return {"name": name, "status": "失败", "error": str(error)}


async def main():
    semaphore = asyncio.Semaphore(2)
    jobs = [
        ("A", 1, False),
        ("B", 3, False),
        ("C", 0.5, True),
        ("D", 0.5, False),
    ]
    tasks = [
        asyncio.create_task(fetch_one(*job, semaphore))
        for job in jobs
    ]
    for completed in asyncio.as_completed(tasks):
        print(await completed)


asyncio.run(main())
```

预期结果：A 成功，B 超时，C 失败，D 成功。完成时间相近的任务之间，输出先后顺序不应作为业务逻辑的依赖。

这里的 2 秒超时从拿到信号量名额后开始计算，**不包括等待名额的排队时间**。如果需要限制包含排队的总耗时，应将超时范围放在获取信号量的外面。

## 14. 共享状态：单线程也可能出现逻辑竞争

两个协程如果在“读取数据”和“写回数据”之间发生暂停，就可能各自基于旧值更新，导致结果错误。

```python
# 示意：多个任务操作同一个 counter。
old = counter
await some_operation()
counter = old + 1
```

必要时可以使用所有相关任务共用的 `asyncio.Lock` 保护这一整段操作：

```python
async with lock:
    old = counter
    await some_operation()
    counter = old + 1
```

这只是结构示意，变量和函数需自行定义。实际设计中应尽量缩短持锁时间，避免让无关工作也排队。`asyncio.Lock` 用于异步任务协作，不是跨线程保护工具。

## 15. 与 JavaScript / TypeScript 的区别

| 行为 | Python | JavaScript / TypeScript |
| --- | --- | --- |
| 调用异步函数 | 返回协程对象，函数体尚未执行 | 返回 Promise，函数体会执行到首次暂停或结束 |
| 等待结果 | `await coroutine_or_task` | `await promise` |
| 并发收集结果 | `asyncio.gather(...)` | `Promise.all(...)` |
| 启动入口 | 脚本中通常使用 `asyncio.run` | 由浏览器或 Node.js 等运行环境驱动 |

这些是概念对应，不表示所有异常和取消语义相同。尤其不要把 Python 的“只调用协程函数不会开始执行”套用到 JavaScript。

## 16. 常见错误速查

| 现象 | 常见原因 | 处理方式 |
| --- | --- | --- |
| 调用了异步函数却没有执行 | 只创建了协程对象 | `await` 它或安排为 Task |
| 写了 `async`，整个程序还是卡住 | 内部存在同步阻塞调用 | 使用异步接口或适当使用 `to_thread` |
| 多个请求仍然按顺序开始 | 在循环中逐个创建并立即等待 | 提前安排任务，或使用 `gather` |
| 快任务的结果迟迟没有显示 | 按固定顺序等待结果 | 使用 `as_completed` |
| 后台任务突然停止 | 主协程已经结束 | 明确任务生命周期，并等待需要完成的任务 |
| 出现未获取的任务异常提示 | 创建 Task 后没人获取其结果或异常 | 等待并处理它，或用 TaskGroup 管理 |
| 信号量没有起到限制作用 | 每个任务创建了自己的信号量 | 共用一个信号量 |
| 设置了超时却很久才返回 | 事件循环被阻塞，或取消清理耗时 | 排查阻塞代码和取消处理 |

## 17. 怎样选择工具？

- 需要前一步结果才能做下一步：连续 `await`。
- 多个任务可以独立执行，最后统一拿结果：`gather`。
- 想先安排一项工作，自己继续做别的：`create_task`，之后明确等待或取消它。
- 谁先完成就先处理谁：`as_completed`。
- 一组任务中一个失败就应停止其他任务：`TaskGroup`。
- 不能一直等：`wait_for` 或 `asyncio.timeout`。
- 同时执行的操作太多：共用 `Semaphore`。
- 必须接入同步阻塞 I/O：考虑 `to_thread`。

## 18. 自测与答案

1. A 等 2 秒，B 等 5 秒，连续 `await` 大约多久？
2. 同样的任务，用 `gather` 大约多久？
3. 提前安排了 A、B，先 `await A`，会让 B 延迟开始吗？
4. B 先完成，`gather` 会把 B 的结果放在第一位吗？
5. 10 个任务每个 2 秒，并发上限 3，大约多久？
6. `async def` 内写 `time.sleep(3)`，会阻塞事件循环线程吗？
7. 超时 2 秒，操作 1 秒完成，会等满 2 秒吗？
8. 取消 `to_thread` 的等待任务，一定能停止已经运行的线程函数吗？

答案：

1. 约 7 秒。
2. 约 5 秒，前提是等待能重叠且没有额外阻塞。
3. 不会。两者已安排，等待 A 时 B 也可以推进；但你会延迟读取 B 的结果。
4. 不会。`gather` 按传入顺序排列结果。
5. 约 8 秒。
6. 会。`async` 不会自动改造函数里的同步代码。
7. 不会，约 1 秒就返回。
8. 不能保证，通常不会停止已经运行的函数。

阅读后建议运行第 2 节、第 6 节和第 13 节，再自行修改延迟、超时和并发上限，观察输出顺序与总耗时。
