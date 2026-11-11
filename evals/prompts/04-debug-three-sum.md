力扣 15「三数之和」：找出整数数组中所有和为零、使用不同下标的三元组，数值组合不能重复。

这是我原来写的代码。请实际执行并自己找出能暴露问题的输入，说明原始输出，再保留排序加双指针的结构做最小修正，给出完整修正版并实际验证。不要保存笔记。

```python
class Solution:
    def threeSum(self, nums: list[int]) -> list[list[int]]:
        nums.sort()
        n = len(nums)
        
        ans = []
        for k in range(n - 2):
            if nums[k] > 0:
                break
            if k > 0 and nums[k] == nums[k - 1]:
                continue
            i, j = k + 1, n - 1
            while i < j:
                curr = nums[k] + nums[i] + nums[j]
                if curr < 0:
                    i += 1
                elif curr == 0:
                    ans.append([nums[k], nums[i], nums[j]])
                    break
                else:
                    j -= 1

        return ans
```
