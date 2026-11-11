允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

这是另一份固定窗口参考版。两个列表不是同一个对象，window == target是不是应该改成is？请实际验证后回答，并分别说明固定26字母表下和一般长度列表比较的成本。不要保存笔记。

```python
class Solution:
    def findAnagrams(self, s: str, p: str) -> list[int]:
        m = len(p)
        if len(s) < m:
            return []

        target = [0] * 26
        window = [0] * 26
        for ch in p:
            target[ord(ch) - ord('a')] += 1

        ans = []
        for j, ch in enumerate(s):
            window[ord(ch) - ord('a')] += 1

            if j >= m:
                window[ord(s[j - m]) - ord('a')] -= 1

            if j >= m - 1 and window == target:
                ans.append(j - m + 1)

        return ans
```
