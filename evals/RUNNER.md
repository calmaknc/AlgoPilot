> 当前采用评分2.0.0：先分别生成自动证据和`review-v2.json`，再运行`node evals/score-v2.mjs <运行目录>`。新结果写入`summary-v2.json`，核心与质量分开。下文`summarize.mjs`保留为v1合并器，不覆盖旧结果。详见[评分规程](SCORING.md)。

# 执行与评分

已实现 `run-live.mjs`、`grade-state.mjs`、`grade-hidden.mjs`、`summarize.mjs`。数据版本为 1.5.0；执行器版本为 1.5.0。所有运行证据放在 Git 忽略的 `runs/`。

## 运行

```sh
node --env-file=.env evals/run-live.mjs
```

默认运行全部 30 条；可追加 `--group baseline` 只运行当前13条基础任务（20轮），或 `--group challenge` 只运行 19～26，也可追加完整 case ID 选择子集。每题独立临时 SQLite、会话、记忆、导出和上下文目录；同题多轮保留状态，18、25 的五个新会话共享题内记忆。只初始化指定 fixtures，评分者资料和源笔记目录不交给模型。工具没有宿主文件读取入口；Python 工具在无挂载、无网络容器执行。允许搜索/抓取，模型请求仍按项目配置联网并收费。

`EVAL_GIT_COMMIT` 可记录提交；执行器记录 src 和评测文件哈希，工作区未提交也可审计。每轮240秒，完整任务1200秒，主循环最多5轮；所有记忆/总结调用计入实际用量。运行失败保留结果，同题后续轮不再发送，其他任务继续。字段 `requiredToolsPresentThisTurn` 仅是诊断；必需工具应由状态评分器按整个任务累计检查。

## 评分

```sh
node evals/grade-state.mjs <运行目录>
node evals/grade-hidden.mjs <运行目录>
node evals/summarize.mjs <运行目录>
```

状态评分检查实际 SQLite 逻辑记录、更新边界、精确正文、导出内容和第一轮删除边界；不把工具出现当作最终通过。隐藏评分提取唯一完整 Solution；遇多个候选或无完整代码标记 needs_review，不擅自修复。候选只收到输入，预期答案留在宿主比较，不可读取评分文件。

隐藏测试使用项目现有 Python Docker 服务：**每组代码的整个小规模样例批次共3秒、128MiB**，不是数据初稿建议的每输入2秒/256MiB。该预算下基础参考实现232/232、挑战参考实现115/115通过；输入批次包含44～64个小样例，结果逐项保存。容器启动另有服务控制时限。无限循环/异常/清理失败均不当作通过。不要将批次超时伪装为已经逐项执行完毕。

评分器验证过5份正确参考解和4份已知错误原版，正确解232/232，错误原版均被拒绝。Markdown代码块提取曾漏掉text围栏之后的Python代码，已修复并加入回归检查。最初的 needs_review 是执行器缺陷，不是 Agent 失败；修复后只重跑评分，没有重跑模型或改变回答。

语义评审仍需评测者填写 `manual-review.json`：每题包含全部 C 项的 verdict/evidence、forbiddenViolations 数组、assessment。应逐条阅读真实回复、工具返回和记忆事件，检查禁止行为；不使用关键词匹配假装完成语义评分。`summarize.mjs` 合并三类证据，缺少评分则 needs_review，不当作通过。本次由 Codex 根据证据完成，尚未经独立人工双评。

## 离线验证

```sh
EVAL_DRY_RUN=1 node --env-file=.env evals/run-live.mjs
node --test evals/grading.test.mjs evals/challenge.test.mjs
```

干跑不调用模型，默认创建30个隔离SQLite并执行63轮调度；`--group challenge` 为8个SQLite、27轮；不能用来测量Agent，评分器会拒绝干跑记录。测试覆盖混合Markdown围栏、重复三元组、原地/节点身份约束以及异常观察。

## 已完成的首轮

运行：`runs/2026-11-11T07-36-00.789Z/`，模型 deepseek-flash，18任务、25轮全部结束，真实数据和原笔记校验未变。

[首轮报告](REPORT-2026-11-11.md)。没有根据失败调整Agent、追加最佳重跑或排除失败。本轮完成后仅补强了执行器版本/哈希记录和诊断字段名称；原运行manifest保留原样，没有追写成运行前已有的元数据。

## 挑战任务的执行与证据

19～24、26 在各自会话内保留上下文；25 的五轮分别新建会话，共享题内记忆。19 第四轮、22 第三轮的最终代码进入隐藏测试，分别检查64个矩阵与51组链表；链表除输出值外检查节点身份、不重复、不成环。

26 使用 `tool-adapter.mjs` 在真实 SQLite 保存成功后，仅将第一次成功响应替换为“不确定是否保存成功”。实际提交、模型可见响应分别记录在运行目录的 `.faults.jsonl` 和逐轮结果中；真实提交证据不交给模型。失败后应查询状态，不能盲目再次保存。`challenge-state.mjs` 检查整个调用序列，重复保存后删除也不能通过。

24 精确比较被授权代码块的替换结果，并检查其他正文、元数据、草稿及无关记录。26 不要求正文标记旁首尾换行逐字保留，但正文内容、唯一记录和导出必须正确。25 的条件性偏好、临时例外、定向修改仍需结合记忆快照逐项语义评审。

运行前写入 `cases.snapshot.json`，评分优先使用该次冻结的任务规格。旧运行无此文件时才回退到当前规格。运行 manifest 保留执行时哈希；后续评分工具修改应另存评分版本哈希，不能覆盖运行时证据。

1.1.1 为挑战任务补充模型可见的离线说明，并给24补全题意，避免与生产环境“仅题号先搜索”提示冲突。首轮仍按冻结的1.1.0规格报告，不将此修订追溯计分，也未重跑模型。

## 挑战集首轮

`runs/2026-11-11T08-33-51.529Z/`：27轮完成，4通过、3失败、1评分争议。详见[挑战报告](REPORT-challenge-2026-11-11.md)。汇总器将benchmarkDefect标为needs_review，原始自动检查不覆盖。

当前数据与执行器版本1.2.0：按用户要求允许联网搜索及读取网页，移除任务提示的联网禁令。个人提交仍以笔记/用户反馈为证据。历史运行保留原快照；Python代码执行容器继续无网络，此限制与Agent网页工具分开。

检索组27～32：使用 `--group retrieval`。语义角色标注完成后运行 `grade-retrieval.mjs <运行目录>`，再由评分v2合并检索证据；详见[RETRIEVAL.md](RETRIEVAL.md)。


## 1.4.0 学习流程组

`--group workflow` 运行11、15、33、34、35（10轮）。包含两条改写任务，不是五条全新增任务。33在第四轮抽取修复代码评分，第五轮单独检查整理保存结果；35在第二轮抽取代码。

34先由评测者从真实最终回答标注全部正式推荐，并独立读取力扣官方题目页面或官方接口，保存题目身份、标签和来源。使用grading/recommendation-review-template.json的结构填写运行目录内recommendation-review.json；再执行：

```sh
node evals/grade-recommendations.mjs <运行目录>
```

随后照常运行state、hidden、summarize和score-v2流程，并准备原有语义评审文件。score-v2自动消费recommendation-grades.json，缺少核验不自动通过。标签未匹配为失败；官方来源不可用或证据缺失为待核验，不把模型自称的tag当证据。无需强制Agent使用某个搜索工具。


## 1.5.0 精简与合并

01、03、10、13退役；16合并到26第三轮，不再独立运行。编号不变且不补齐空缺，当前全套30条63轮。传入已退役ID将报Unknown case，不会静默执行旧文件。baseline为13条20轮；challenge、retrieval、workflow分组的成员数不变。26保持3轮，新增C5审阅实际返回路径、源笔记保护与不虚构外部链接。

历史运行保留cases.snapshot.json及原始结果，旧提示、评分卡和retired-cases.json仅供追溯。不得把删减后的通过率直接解释为Agent能力提高。

## 目录与当前执行预算

评测文件统一位于`evals/`，旧8条评测已删除。每个用户回合最多12次主模型请求，最后一次禁止工具调用并要求最终回复；记忆及上下文恢复调用另计。新运行清单记录`maxNormalModelRoundsPerTurn: 12`与`finalReplyOnlyRound: 12`，历史运行清单保留当时原值。
