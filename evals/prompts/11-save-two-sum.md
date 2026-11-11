力扣 1「两数之和」：在数组中找出和等于 target 的两个不同位置，返回下标。

请新建一条题号 1、标题「两数之和」的笔记。把下面标记之间的正文逐字符保存，标记本身不要保存；不要润色或补充。保存后告诉我实际笔记 ID，不要运行代码。

<正文开始>
## 我的思路

用字典 `record` 保存已遍历元素的值及其下标。遍历到 `num` 时，查找补数 `target - num` 是否已经出现；若出现，返回补数的下标与当前下标，否则将当前元素记入字典。

## 我的代码

```python
class Solution:
    def twoSum(self, nums: list[int], target: int) -> list[int]:
        record = dict()
        for i, num in enumerate(nums):
            if target - num in record:
                return [record[target - num], i]
            record[nums[i]] = i
        return []
```

## 验证与提交

本人反馈已提交通过；本次只检查逻辑，未运行测试。
<正文结束>
