力扣 48「旋转图像」：将非空 n×n 方阵原地顺时针旋转 90 度。

我记得技巧是先转置、再左右翻转，但下面的代码结果不对。请实际运行原代码，展示一个最小规模的有效反例；保留这两步做最小修正，给出完整修正版并实际验证。再用坐标解释两步为什么得到顺时针旋转。不要保存笔记。

```python
class Solution:
    def rotate(self, matrix: list[list[int]]) -> None:
        """
        Do not return anything, modify matrix in-place instead.
        """
        # 这题我见过，翻转图像就是先转置，后左右翻转
        m, n = len(matrix), len(matrix[0])
        for i in range(m):
            for j in range(n):
                matrix[i][j], matrix[j][i] = matrix[j][i], matrix[i][j]

        for i in range(m):
            for j in range(n // 2):
                matrix[i][j], matrix[i][n - j - 1] = matrix[i][n - j - 1], matrix[i][j]
```
