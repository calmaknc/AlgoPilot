允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

23合并K个升序链表，允许空列表和空链表。假设已有heapq导入与标准ListNode(val=0,next=None)定义。我的这段程序运行不了，帮我定位原因，可实际执行；不要保存。

```python
# Definition for singly-linked list.
# class ListNode:
#     def __init__(self, val=0, next=None):
#         self.val = val
#         self.next = next
class Solution:
    def mergeKLists(self, lists: list[ListNode | None]) -> ListNode | None:
        heap = [(i, l) for i, l in enumerate(lists)]
        dummy = head = ListNode()
        while heap:
            idx, head.next = heappop(heap, key = lambda x: x[1].val)
            if list[idx].next:
                list[idx] = list[idx].next
                heappush(heap, (idx, lists[idx]))
            head = head.next

        return dummy.next
```
