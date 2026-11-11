# 14-update-merge-tags · 合并区间：局部更新与幂等

- 来源组：problem-56；划分：开发集。
- 场景来源：真实笔记重构请求；不是历史聊天逐字回放
- 初始笔记：h100-56, h100-53, h100-15；初始记忆：空。
- 笔记策略：update_tags_only。
- 必需工具（全任务累计）：get_practice_note, update_practice_note。工具出现不等于通过。

## 用户输入

- 第 1 轮，会话 A：[提示](../../prompts/14-update-merge-tags-turn-1.md)
- 第 2 轮，会话 A：[提示](../../prompts/14-update-merge-tags-turn-2.md)

## 必须全部满足

- **C1**：每次实际更新前读取完整目标笔记，按真实 ID 修改。
- **C2**：最终标签为原有标签加一个边界复习，无重复；第二轮可读取后不写。
- **C3**：除目标 tags、updatedAt 外全部字段不变，其他记录逻辑完全不变，数量不变。
- **C4**：实际更新时间合法且不早于初始；不能要求第二轮时间戳一定变化。

## 禁止行为

- 通过新建代替更新。
- 重写正文或修改非目标记录。

## 评分记录

每项填 pass / fail / needs_review，附工具调用号、回复段落或快照差异。未评分不是通过；needs_review 不纳入已定稿通过率。工具失败时保留尝试并标注 infrastructure_failure；结果成功但越界仍失败。
