力扣 283「移动零」：原地把所有零移到数组末尾，保持非零元素的相对顺序。

请把我的思路整理成“思路、为什么安全、复杂度”三个短段落，只展示给我看，不要保存或运行。我的想法是：slow 记下一个写非零数的位置，遍历时把非零数依次放到前面，最后补零。

```python
class Solution:
    def moveZeroes(self, nums: list[int]) -> None:
        """
        Do not return anything, modify nums in-place instead.
        """
        slow = 0
        for num in nums:
            if num != 0:
                nums[slow] = num
                slow += 1

        for i in range(slow, len(nums)):
            nums[i] = 0
```
