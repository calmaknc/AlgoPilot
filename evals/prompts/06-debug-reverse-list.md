力扣 206「反转链表」：原地反转单链表，返回新头节点，允许空链表。

这是我曾遇到内存超限时的代码。请补上简单 ListNode 和构造包装，实际运行原版，用有上限的遍历或节点身份检测观察结果，再保留当前迭代结构做最小修正，给出完整修正版并实际验证。不要无限遍历，不要保存笔记。

```python
class Solution:
    def reverseList(self, head: ListNode | None) -> ListNode | None:
        curr, nxt = head, head.next
        while nxt != None:
            tmp = nxt.next
            nxt.next = curr
            curr, nxt = nxt, tmp
        return curr
```
