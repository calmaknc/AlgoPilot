请整理并保存一条「两数之和」笔记，题号1。下面是我的代码，我反馈它已提交通过；这次不需要执行。请明确记上：我的原始代码、为什么先查后存、[3,3]且target=6时如何得到两个不同下标，以及提交情况。正文组织和排版由你决定，不用逐字照抄这段要求。
```python
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen:
                return [seen[target - x], i]
            seen[x] = i
```
