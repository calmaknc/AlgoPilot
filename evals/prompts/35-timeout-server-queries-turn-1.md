2747统计没有收到请求的服务器：服务器编号1到n，logs每项是[server_id,time]。对每个query，返回闭区间[query-x,query]没有日志的服务器数量，答案保持查询原顺序。时间值可很大，日志很稀疏。我的程序平台超时了，先定位瓶颈，必要时做小规模实验，不要直接长时间跑超大输入，也先不重写或保存。
```python
from collections import defaultdict
from typing import List
class Solution:
    def countServers(self, n: int, logs: List[List[int]], x: int, queries: List[int]) -> List[int]:
        time_dict = defaultdict(list)
        for log in logs:
            server_id, time = log
            time_dict[time].append(server_id)

        ans = []
        for query in queries:
            start, end = query - x, query
            tmp = set()
            for i in range(start, end + 1):
                tmp |= set(time_dict[i])

            ans.append(n - len(tmp))

        return ans
```
