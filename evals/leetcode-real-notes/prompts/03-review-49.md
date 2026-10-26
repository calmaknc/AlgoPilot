力扣 49，输入只包含小写英文字母。我觉得这个代码很慢，能不能优化？请先判断它是否正确，再分析排序的到底是什么，以及换成 26 位计数元组后复杂度会怎样。不需要运行或保存笔记；没有实测就别给加速倍数。假设已导入 Counter。

```python
class Solution:
    def groupAnagrams(self, strs: list[str]) -> list[list[str]]:
        record = {}
        for s in strs:
            unique = tuple(sorted(Counter(s).items()))
            if unique in record:
                record[unique].append(s)
            else:
                record[unique] = [s]

        return list(record.values())
```
