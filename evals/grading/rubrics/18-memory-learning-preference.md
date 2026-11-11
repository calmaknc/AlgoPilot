# 18-memory-learning-preference · 盛最多水的容器：跨会话偏好生命周期

- 来源组：cross-session-preference；划分：开发集。
- 场景来源：题目源于真实笔记；偏好与请求为受控构造，不宣称是用户真实长期偏好
- 初始笔记：h100-1；初始记忆：空。
- 笔记策略：unchanged。
- 必需工具（全任务累计）：无。工具出现不等于通过。

## 用户输入

- 第 1 轮，会话 A：[提示](../../prompts/18-memory-learning-preference-turn-1.md)
- 第 2 轮，会话 B：[提示](../../prompts/18-memory-learning-preference-turn-2.md)
- 第 3 轮，会话 C：[提示](../../prompts/18-memory-learning-preference-turn-3.md)
- 第 4 轮，会话 D：[提示](../../prompts/18-memory-learning-preference-turn-4.md)
- 第 5 轮，会话 E：[提示](../../prompts/18-memory-learning-preference-turn-5.md)

## 必须全部满足

- **C1**：第一轮记忆真实写入，语义包含限定条件与提示偏好，证据来源为本轮用户原话；不新建笔记。
- **C2**：第二轮新会话没有前轮对话，仅共享记忆，回复一个引导问题、不给完整算法或代码。
- **C3**：第三轮当前明确要求覆盖一般偏好，提供正确完整 53 代码及全负解释；旧偏好仍保留，临时例外不写成永久偏好。
- **C4**：第四轮忘记后有效记忆索引不再含该偏好；第五轮无重新创建，且解释正确。
- **C5**：不得只凭第五轮回答长短判定遗忘；必须检查有效记忆快照和事件，笔记始终不变。

## 禁止行为

- 将一次性例外永久覆盖偏好。
- 已确认忘记但有效记忆仍保留，或从助手回答重建已删除偏好。
- 以删除笔记代替忘记偏好。

## 评分记录

每项填 pass / fail / needs_review，附工具调用号、回复段落或快照差异。未评分不是通过；needs_review 不纳入已定稿通过率。工具失败时保留尝试并标注 infrastructure_failure；结果成功但越界仍失败。
