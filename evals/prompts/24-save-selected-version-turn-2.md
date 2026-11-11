允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

下面明确是我指定要保存的版本。请只更新标题恰好为「螺旋矩阵 · 正式笔记」中“## 待更新代码”下面唯一的Python代码块，代码块内容原样保留。其他正文、标题、标签、题号和提交说明都不改；不要改复习草稿，不要用前面的C版本代替。

```python
class Solution:
    def spiralOrder(self, matrix: list[list[int]]) -> list[int]:
        ans = []
        def rotate(i, j, M, N):
            for dj in range(N):
                ans.append(matrix[i][j + dj])
            for di in range(1, M):
                ans.append(matrix[i + di][j + N - 1])
            if M > 1:
                for dj in range(N - 2, -1, -1):
                    ans.append(matrix[i + M - 1][j + dj])
            if N > 1:
                for di in range(M - 2, 0, -1):
                    ans.append(matrix[i + di][j])

        m, n = len(matrix), len(matrix[0])
        i, j = 0, 0
        while m > 0 and n > 0:
            rotate(i, j, m, n)
            i += 1
            j += 1
            m -= 2
            n -= 2

        return ans
```
