允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

我另外准备了下面这个版本，空链表和建堆已处理。不同值上能跑，为什么两条链表都以1开头就报错？先解释当前版本，不要重写或给修复代码，不保存。ListNode没有定义大小比较。

```python
from heapq import heapify, heappop, heappush
class Solution:
    def mergeKLists(self, lists: list[ListNode | None]) -> ListNode | None:
        heap = [(node.val, node) for node in lists if node is not None]
        heapify(heap)
        dummy = tail = ListNode()
        while heap:
            _, node = heappop(heap)
            tail.next = node
            tail = node
            if node.next is not None:
                heappush(heap, (node.next.val, node.next))
        return dummy.next
```
