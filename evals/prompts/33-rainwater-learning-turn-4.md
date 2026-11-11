我试着写了栈版本，但结果不对。请实际运行定位问题，保留我的栈结构给出一份完整修正版，并验证修复。不要把你的代码称作我的提交版本，先不保存。
```python
class Solution:
    def trap(self, height: list[int]) -> int:
        # 刚刚试了一列一列算，现在试一行一行算
        ans = 0
        stack = []
        for i, h in enumerate(height):
            while stack and height[stack[-1]] <= h:
                bottom = stack.pop()

                if not stack:
                    break

                left = stack[-1]
                h = min(height[left], h) - height[bottom]
                w = i - left - 1
                ans += h * w

            stack.append(i)

        return ans
```
