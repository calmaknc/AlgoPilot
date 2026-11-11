允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

我另外准备了一版，只在函数入口处理整个矩阵单行、单列，现在应该完整了吧？请针对这一版回答，不要保存。

```python
class Solution:
    def spiralOrder(self, matrix: list[list[int]]) -> list[int]:
        if len(matrix) == 1:
            return matrix[0][:]
        if len(matrix[0]) == 1:
            return [row[0] for row in matrix]
        ans = []
        def rotate(i, j, M, N):
            nonlocal ans
            for dj in range(N):
                ans.append(matrix[i][j + dj])
            for di in range(1, M):
                ans.append(matrix[i + di][j + N - 1])
            for dj in range(N - 2, -1, -1):
                ans.append(matrix[i + M - 1][j + dj])
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
