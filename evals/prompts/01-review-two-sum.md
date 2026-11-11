力扣 1「两数之和」：在数组中找出和等于 target 的两个不同位置，返回下标。

以下是我的代码。请判断它是否正确，用 nums=[3,3]、target=6 解释两次循环的变化，以及为什么不会重复使用同一个下标。分析复杂度。不要运行代码，也不要保存笔记。

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
