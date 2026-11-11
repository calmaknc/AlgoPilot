力扣 3「无重复字符的最长子串」：求字符串中不含重复字符的最长连续子串长度；字符可以包含字母、数字、符号和空格。

请实际执行我的原代码并选择有代表性的边界输入，定位问题；保留“最近出现位置＋移动窗口边界”的思路，给出完整修正版并实际验证。解释你采用的窗口边界含义，不要保存笔记。

```python
class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last = [-1] * 26
        ans = 0
        start = 0
        for i, ch in enumerate(s):
            last_ch = last[ord(ch) - ord('a')]
            start = max(last_ch, start)
            ans = max(ans, i - start)
            last[ord(ch) - ord('a')] = i

        return ans
```
