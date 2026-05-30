# 产品经理角色能力断层分析

## 对比基准

同样的 `D:\temp\Codex\icloser-forge` 项目，对比工具展示的内容 vs iCloser 能提供的。

### 对比工具为 PM 提供了什么

```
一、项目概况 (表格: 维度/状态)
二、V0.7 发布卡关状态：NO-GO
  ├─ 2 个阻塞项 (task-029 NSIS / task-030 命令反馈)
  ├─ 每个阻塞项的状态 + 说明
  └─ 清晰的 YES/NO 判断
三、代码完成度：~95%
四、测试覆盖度：~60-70%
五、架构债务 (表格: 问题/严重度/说明)
六、路线图进度
  V0.1 ✓ → V0.2 ✓ → V0.5 ✓ → V0.6 ✓ → [V0.7 RC] → V1.0 → V1.5 → V2.0
七、综合评估 (编号列表)
```

### iCloser 当前能提供什么

```
- ic st: 任务列表 (JSON/文本)
- ic r: 最近报告 (Markdown)
- ic overview: 项目健康总览
- ic autopilot: 自动分析 (文档缺口/测试缺口)
- ANALYSIS.md: AI 分析报告
```

---

## 7 个 PM 角色断层

### 断层 PM1：无发布卡关判断

**PM 需要**：一眼看出当前版本能否发布，有哪些阻塞项。

**当前**：`ic st` 列出所有任务但不区分版本，不判断是否阻塞发布。
`ic gate` 只检查 6 道门禁（测试/安全/推理/报告/回滚/Git），不检查 **业务阻塞项**。

**目标**：`ic release-status` 命令输出：
```
V0.7 RC: NO-GO (2 blocks)
  ❌ task-029: NSIS 桌面快捷方式 (READY_FOR_DEVELOPMENT)
  ❌ task-030: 命令执行反馈 (自测PASS, 缺架构师签字)
V1.0: 未开始 (6 tasks pending)
```

**在哪实现**：新增 `src/core/release-checker.ts` + CLI `ic release` 命令

---

### 断层 PM2：无路线图可视化和进度追踪

**PM 需要**：版本里程碑 + 各版本完成百分比 + 剩余工作量。

**当前**：任务系统有 `TaskStatus` 但没有 `version`/`milestone` 字段。
没有跨版本聚合视图。

**目标**：`ic roadmap` 输出：
```
V0.1 ████████ 100%  CLI骨架
V0.2 ████████ 100%  Provider连接
V0.5 ████████ 100%  多Agent
V0.6 ████████ 100%  IDE基础
V0.7 ██████░░  85%  RC — 2 blocks
V1.0 ░░░░░░░░   0%  真正可用
```

**在哪实现**：`Task` 类型新增 `milestone?: string` + CLI `ic roadmap`

---

### 断层 PM3：无风险矩阵

**PM 需要**：按影响×概率排列的风险清单，技术债务分级。

**当前**：架构债务发现是 AI 自由文本，无结构化风险数据。

**目标**：
```
风险矩阵:
  高影响×高概率: task-012 审查视图 (11轮迭代仍未通过)
  高影响×低概率: IDE单文件巨石 (功能可用但不可维护)
  低影响×高概率: 缺少ESLint (可随时添加)
```

**在哪实现**：`src/core/risk-analyzer.ts`，从任务历史+代码分析自动生成

---

### 断层 PM4：无利益相关者报告

**PM 需要**：面向非技术角色的周报/里程碑摘要。

**当前**：`ic r` 报告是面向开发者的技术报告（文件变更/推理链/验证结果）。
无执行摘要、无进度百分比、无下一步建议。

**目标**：`ic report --executive` 输出：
```
# 项目周报 — iCloser Forge V0.7 RC
## 本周进度: 85% → 87% (+2%)
## 阻塞项: task-029, task-030
## 下周计划: 修复阻塞项 → 发布 V0.7
## 风险: 1 high, 2 medium, 3 low
```

**在哪实现**：`report/generator.ts` 新增 `generateExecutiveReport()`

---

### 断层 PM5：无需求/PRD 解析

**PM 需要**：从 PRD.md / ROADMAP.md 等文档中提取需求清单和功能范围。

**当前**：上下文注入了 README 但未解析 PRD/需求文档的结构化内容。

**目标**：自动读取 `docs/PRD.md`、`docs/ROADMAP.md`，提取：
- 功能列表 (checkbox: ✅/⬜)
- 优先级 (P0/P1/P2)
- 负责模块
- 预计版本

**在哪实现**：`context.ts` 新增 `parsePRDContent()` + 增强 `assembleProjectMeta`

---

### 断层 PM6：无依赖关系分析

**PM 需要**：知道哪些任务相互阻塞，哪些可以并行。

**当前**：`task-engine.ts` 有 `taskDependencies` Map 但未在报告中可视化。

**目标**：
```
阻塞链:
  task-029 ──→ V0.7 发布
  task-030 ──→ V0.7 发布
  task-012 ──→ V1.0 审查功能
依赖图: (ASCII art)
  task-029 ──┐
  task-030 ──┤──→ V0.7 Release
  task-012 ──┘
```

**在哪实现**：`task-engine.ts` 导出 `getBlockingChain()` + CLI `ic deps`

---

### 断层 PM7：无工时/复杂度估算

**PM 需要**：任务复杂度评估（story points / t-shirt sizing）。

**当前**：任务只有 `priority` (high/normal/low)，无 effort 估算。

**目标**：AI 自动评估任务复杂度：
```
ic estimate "添加用户权限管理"
  → 复杂度: M (Medium)
  → 影响模块: auth, middleware, user-model
  → 预估: 3-5 天
  → 风险: 涉及认证流程变更
```

**在哪实现**：`src/core/effort-estimator.ts` — AI 驱动复杂度评估

---

## 实现优先级

| 优先级 | 断层 | 用户价值 | 复杂度 | 依赖 |
|--------|------|---------|--------|------|
| 🔴 P0 | PM1 发布卡关 | 最高 | 低 | Task 系统已有 |
| 🔴 P0 | PM5 PRD 解析 | 高 | 中 | context.ts |
| 🟡 P1 | PM2 路线图 | 高 | 中 | Task.milestone |
| 🟡 P1 | PM4 利益相关者报告 | 高 | 低 | report/generator |
| 🟡 P1 | PM6 依赖分析 | 中 | 低 | task-engine.ts |
| 🟢 P2 | PM3 风险矩阵 | 中 | 高 | 需要历史数据 |
| 🟢 P2 | PM7 工时估算 | 中 | 中 | 需要 AI |

## 总体设计思路

不是新建一个 PM 模块，而是让现有系统**从不同角色的视角输出**：

```
同一份数据，不同视角：
  开发者视角 (ic r) → 文件变更、推理链、验证结果
  PM视角    (ic r --summary) → 进度、阻塞、风险、下一步
  QA视角    (ic r --qa) → 测试覆盖、失败清单、回归风险
  架构师视角 (ic r --arch) → 债务、耦合度、循环依赖
```

核心改动：**报告引擎多视角输出** + **Task 增加 milestone 字段** + **PRD 文档解析**。
