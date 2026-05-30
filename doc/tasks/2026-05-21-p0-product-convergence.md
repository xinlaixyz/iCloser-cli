# P0 产品收束

日期：2026-05-21

## 一、目标

当前项目已经有很多能力，但用户感知上仍然比较散。P0 不是继续堆新功能，而是把已有能力收束成一个完整产品。

核心主线：

**理解需求 -> 调用记忆与上下文 -> 调用工具 -> 形成答案或计划 -> 展示证据 -> 沉淀经验。**

## 二、本轮改动

### 1. 新增能力地图

新增文档：`doc/CAPABILITY_MAP.md`。

这份文档按用户结果组织能力，而不是按代码模块罗列能力。当前分组包括：

- 首次启动
- 模型服务
- 项目理解
- 工具使用
- 代码交付
- 验证能力
- 长期记忆
- 安全掌控
- 团队协作
- 发布信任
- macOS 体验
- REPL 交互

它同时定义了 P0 产品契约：每一次 AI 工具任务都应该展示五个阶段。

### 2. REPL 五阶段流程

在 REPL 中新增固定阶段展示：

1. 理解需求
2. 调用工具
3. 形成结论
4. 验证证据
5. 沉淀记忆

这样用户看到的不再是一串松散工具日志，而是一条稳定的 Agent 工作路径。

### 3. 黄金路径面板

工具任务结束后，REPL 会渲染一个紧凑的黄金路径面板，展示：

- 本轮用了哪些工具
- 每个阶段的状态
- 本轮证据数量
- 结果是否完成
- 缺少验证时的下一步建议

这个面板用于把“工具调用”和“最终回答”之间的关系讲清楚，也为后续验证、记忆、报告体验留出统一入口。

## 三、涉及文件

- `doc/CAPABILITY_MAP.md`
- `src/cli/repl.ts`
- `tests/repl-ai-routing.test.ts`

## 四、验收结果

- `npx tsc --noEmit` 通过。
- `npx vitest run tests\repl-ai-routing.test.ts tests\repl-tool-viz.test.ts tests\provider.test.ts` 通过，共 61 个测试。
- `npm run build` 通过。
- `npm run lint` 通过。
- `npm test` 全量通过：122 个测试文件，1748 passed，2 skipped。

## 五、剩余 P0 跟进

根据 2026-05-21 新验收口径，P0/P1 收束为四件事：

| 优先级 | 任务 | 验收文档 |
|---|---|---|
| P0 | 建立“黄金路径面板”，让用户一眼看到 AI 做了什么、用了哪些工具、结果是什么 | `doc/GOLDEN_PATH_AND_SCORE_ACCEPTANCE_2026-05-21.md` |
| P1 | 整理命令分组：`setup/project/ai/tools/code/memory/collab/release` | `doc/CAPABILITY_MAP.md` |
| P1 | 做 3 个真实样板任务：网页访问、Android 需求转 H5 网页、修复 Web 项目 bug | `doc/GOLDEN_PATH_AND_SCORE_ACCEPTANCE_2026-05-21.md` |
| P1 | 把评分写入验收文档，后续每轮开发按分数推进 | `doc/GOLDEN_PATH_AND_SCORE_ACCEPTANCE_2026-05-21.md` |

下一步需要用真实 REPL 跑三类任务：

- 网页访问与追问。
- Android / App 需求转 H5 网页。
- Web 项目 bugfix。

如果黄金路径面板在真实使用中显得过于吵，可以默认折叠为一行，再用 `/details` 展开。

## 六、评分推进要求

后续每次开发结束必须记录：

- 开发前分数。
- 目标分数。
- 实际分数。
- 支撑证据路径。
- 未通过项和下一轮动作。

没有真实样板任务证据，不允许把“功能完成”直接换算成“体验提升”。
