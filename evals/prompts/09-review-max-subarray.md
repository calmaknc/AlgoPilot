力扣 53「最大子数组和」：从非空整数数组中找一个和最大的非空连续子数组，返回其和。

这段代码 dp 从 0 开始，全负数组是不是会算错？请先判断，再用 [-5,-2,-7] 手工追踪 dp 和 ans，并解释这两个量分别代表什么。不要运行、重写或保存。

```python
class Solution:
    def maxSubArray(self, nums: list[int]) -> int:
        dp = 0
        ans = -float('inf')
        for num in nums:
            dp = max(dp + num, num)
            ans = max(ans, dp)

        return ans
```
