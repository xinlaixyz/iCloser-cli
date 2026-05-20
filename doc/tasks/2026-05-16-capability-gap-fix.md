# 能力偏差修复任务

日期：2026-05-16
来源：`CAPABILITY_INTENT_GAP.md` 审计 — 8 项主张中 6 项存在"最后一公里未完成"
性质：全部是已有代码的集成补全，不涉及新架构
状态：✅ 全部完成。tsc 零错误。456 测试通过。

---

## Gap-1: 编译闸门补齐 (2h)

**现状**：`enforceCodeQuality` 已实现但只在 `ic gen new` 和 `ic t` 两条路径上调用。8 条写入路径直接写文件。

**修复**：在以下路径写入前调用 `enforceCodeQuality`：
- `ic gen fix` (index.ts:2376)
- `ic gen complete` (index.ts:2398)
- `ic code new` (index.ts:2747)
- `ic code fix` (index.ts:2805)
- `ic code complete` (index.ts:2827)
- `ic code refactor` (index.ts:2855)
- 文档生成写入 (index.ts:2010)
- 文档编辑写入 (index.ts:2057)

**验收**：`npm test` 全通过，`tsc --noEmit` 零错误

---

## Gap-2: DAG 执行接入 (4h)

**现状**：`dag-scheduler.ts` 实现了完整的拓扑排序 + 循环检测 + 并行级别分组，但 `executeDAG` 函数从未被调用。`ic plan dag` 只展示层级，`ic plan run-all` 是顺序执行。

**修复**：
- `ic plan run-all` 调用 `executeDAG` 按层级并行执行无依赖任务
- 同层任务并行生成，层间串行等待
- 任一任务失败时停止后续层级

**验收**：创建 3 个有依赖关系的测试任务 → `ic plan run-all` → 验证依赖顺序正确

---

## Gap-3: Monorepo 下游消费 (2h)

**现状**：`scanProject()` 调用 `detectSubprojects` 将结果写入 `index.subprojects`，但 `cmdStartProject()` 不读取这个数据，每次重新调用 `scanForSubProjects`。

**修复**：
- `cmdStartProject` 优先从 `loadProjectIndex` 读取 `subprojects`
- 仅当索引不存在时才回退到 `scanForSubProjects` 扫描
- 减少启动时的文件系统扫描开销

**验收**：扫描后启动 → 验证优先使用缓存的子项目数据

---

## Gap-4: 执行引擎去回退 (3h)

**现状**：`executeWithPlan` 是系统驱动循环，但如果它抛异常，`executeTask` 中有一个 catch 回退到单次 AI 调用（传统模式）。这意味着引擎可以被静默绕过。

**修复**：
- 移除 `executeTask` 中对引擎异常的 catch 回退分支
- 改为在 `executeWithPlan` 内部增加重试逻辑（利用已有的 `shouldReplan` 决策点）
- 引擎真正不可用时让任务失败，而非静默降级

**验收**：模拟引擎异常 → 验证任务标记为 failed 而非静默回退

---

## Gap-5: 记忆验证收紧 (1h)

**现状**：`verifyMemoryFactualAccuracy` 只在所有提及文件都缺失且 ≥2 个时才拒绝记忆。单文件陈旧可通过。幻觉标记只有 4 个中文模式。

**修复**：
- 改为：任一核心文件（含 / 或 \\ 的路径）缺失即拒绝记忆
- 扩充幻觉标记到 10+ 个模式（含英文："you asked me to", "as per your request", "last time we", "in the previous conversation"）
- 增加 AST 符号检查：记忆中提到函数/类名时查询 index 确认符号仍存在

**验收**：创建引用已删除文件的记忆 → 验证被排除；创建包含幻觉标记的记忆 → 验证被排除

---

## Gap-6: 文档修正 (0.5h)

**现状**：多处文档声称"9 语言 AST 解析"。真实情况：5 语言有 tree-sitter（TS/JS 始终可用，Go/Python/Java/Kotlin 条件可用）+ 3 语言正则回退（Swift/ObjC/SQL）。

**修复**：
- `ARCHITECTURE.md` 更新描述
- `PROJECT_STATUS.md` 更新
- `ast-parser.ts` 顶部注释更新

**验收**：文档中不再出现"9 语言 AST"的错误表述

---

## 执行顺序

```
Gap-5 (1h) → Gap-1 (2h) → Gap-6 (0.5h) → Gap-3 (2h) → Gap-4 (3h) → Gap-2 (4h)
```

从小到大的风险递增顺序。Gap-5 和 Gap-6 风险最低，Gap-2 和 Gap-4 影响面最大。
