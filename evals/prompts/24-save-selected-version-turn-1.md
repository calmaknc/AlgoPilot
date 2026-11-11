允许按需联网搜索和读取网页；个人刷题经历与提交状态仍须依据已有笔记或用户反馈，不从公开网页推断。

题意已知：给定非空 m×n 矩阵，按顺时针从外到内遍历，每个元素恰好输出一次，返回遍历序列。

下面是本次讨论的三个54螺旋矩阵版本。A为我的原始版；B为仅入口处理单行单列的评测半修正版；C为评测提供的助手参考实现，不是我的提交源码。请整理各版差别，先别保存。

版本A：
```python
class Solution:
    def spiralOrder(self, matrix: list[list[int]]) -> list[int]:
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

版本B：
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

版本C：
```python
class Solution:
    def spiralOrder(self, matrix: list[list[int]]) -> list[int]:
        top, bottom = 0, len(matrix) - 1
        left, right = 0, len(matrix[0]) - 1
        result = []
        while top <= bottom and left <= right:
            for col in range(left, right + 1):
                result.append(matrix[top][col])
            top += 1
            for row in range(top, bottom + 1):
                result.append(matrix[row][right])
            right -= 1
            if top <= bottom:
                for col in range(right, left - 1, -1):
                    result.append(matrix[bottom][col])
                bottom -= 1
            if left <= right:
                for row in range(bottom, top - 1, -1):
                    result.append(matrix[row][left])
                left += 1
        return result
```
