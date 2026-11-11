允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

438找到字符串中所有字母异位词：s和p只含小写英文字母，p非空，返回s中所有长度等于p且计数相同的片段起点。这里for里面套while，应该是平方复杂度吧？帮我优化；若前提不成立请纠正。不要保存。

```python
class Solution:
    def findAnagrams(self, s: str, p: str) -> list[int]:
        p_set = [0] * 26
        for ch in p:
            p_set[ord(ch) - ord('a')] += 1

        ans = []
        start = 0
        s_sub_set = [0] * 26
        for j, ch in enumerate(s):
            ch_idx = ord(ch) - ord('a')
            s_sub_set[ch_idx] += 1
            while s_sub_set[ch_idx] > p_set[ch_idx]:
                s_sub_set[ord(s[start]) - ord('a')] -= 1
                start += 1
            if j - start + 1 == len(p):
                ans.append(start)
                s_sub_set[ord(s[start]) - ord('a')] -= 1
                start += 1

        return ans
```
