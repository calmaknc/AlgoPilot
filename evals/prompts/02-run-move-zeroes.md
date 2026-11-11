力扣 283「移动零」：原地把所有零移到数组末尾，保持非零元素的相对顺序。

请实际运行我的原代码，检查 [0,1,0,3,12] 和 [0]，说明函数返回值和数组修改结果分别是什么，再解释遍历时覆盖数组会不会破坏还没读到的元素。说明新增的测试包装，不要改算法，也不要保存笔记。

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
