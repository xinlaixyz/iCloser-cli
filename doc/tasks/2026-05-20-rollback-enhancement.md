# Rollback 增强任务拆分

> 2026-05-20 — 基于 `ic rollback --auto` 收尾后的三项缺口分析

## 总览

| 阶段 | 任务 | 优先级 | 估时 | 依赖 |
|------|------|--------|------|------|
| A | 数据流整合：回滚事件广播到 memory/task/audit/gate | 🔴 高 | 3-4h | — |
| B | AI 修复增强：正则失败后 fallback 到 AI provider | 🔴 高 | 4-6h | A |
| C | 测试自动化：CI 验收 + e2e smoke + 异常路径 | 🟡 中 | 2-3h | A, B |

**建议执行顺序：A → B → C**

---

## A. 数据流整合

### A.1 Memory Kernel: 新增 `onRollback` 钩子

- **文件** `src/core/memory/runtime.ts`
- **内容** 在 `MemoryRuntime` 类中新增 `onRollback(taskId, result)` 方法，调用 `recordEpisode('rollback_executed', taskId, ...)`
- **验证** `onRollback` 执行后，`rollback_executed` episode 出现在 `ic mem inspect episodic` 输出中

### A.2 Task Engine: 新增 `rolled-back` 状态

- **文件** `src/core/task-engine.ts`、`src/types.ts`
- **内容** Task status 枚举新增 `'rolled-back'`，`updateTaskStatus` 接受该值；回滚后调用 `releaseFileLocks`
- **验证** `ic st --json` 中回滚后的任务显示 `status: "rolled-back"`

### A.3 Audit: 新增 `rollback-executed` 动作

- **文件** `src/types.ts`（AuditAction）、`src/core/audit.ts`
- **内容** 新增 `'rollback-executed'` 动作类型；rollback 完成后写入审计记录
- **验证** `ic audit` 能看到回滚事件

### A.4 广播接入：`rollbackAutopilotChanges()` 执行后触发

- **文件** `src/core/autopilot-rollback.ts`、`src/index.ts`
- **内容** rollback 成功后调用 memory/audit/task 的对应钩子，传递 receipts 和原因
- **验证** 执行 `ic rollback --auto` 后，三个系统都能查到回滚记录

### A.5 Execution Chain: 回滚阶段标记

- **文件** `src/core/execution-chain.ts`
- **内容** 已定义 `id: 'rollback'`（第 138 行），补全其 executor 函数，rollback 时调用 `advanceStage('rollback')`
- **验证** 执行链状态中能显示 rollback 阶段已完成

---

## B. AI 修复增强

### B.1 修复回路接入 AI Provider

- **文件** `src/core/autopilot-repair.ts`
- **内容** 新增 `buildAIRepairPlan(receipt, files)` 函数：
  - 构造包含验证失败输出 + 当前文件内容的 prompt
  - 调用 `provider.chat({ systemPrompt, task, context })`
  - 要求 AI 返回 JSON 变更契约（与 code-writer 格式兼容）
  - 失败时返回 `null`（降级到正则修复）
- **验证** Mock AI 下 AI 修复返回有效修复计划

### B.2 修复回路改为二级 Fallback

- **文件** `src/core/autopilot-repair.ts`（`buildAutopilotRepairPlan` 重命名/重构）
- **内容** 修复策略改为：
  1. 正则引擎先尝试（当前逻辑，快速路径）
  2. 正则失败 → `buildAIRepairPlan()` 尝试 AI 修复
  3. AI 也失败 → 标记 `autoApply: false`
- **验证** 正则能处理的问题仍走正则，正则处理不了的走 AI

### B.3 `runAutopilotRepairLoop` 增加 AI 尝试轮次

- **文件** `src/index.ts`（`runAutopilotRepairLoop`）
- **内容** 当正则修复结果为 `confidence: low` 时，不立即判定失败，而是调用 AI 修复再试一轮
- **验证** Mock AI 下 `MAX_AUTOPILOT_REPAIR_ATTEMPTS` 内的 AI 修复路径被测试

### B.4 超时/限流回退

- **文件** `src/core/autopilot-repair.ts`
- **内容** AI 调用增加 30s 超时；限流错误（429）自动降级到正则；API 不可用时跳过 AI
- **验证** 模拟 AI 超时，回退逻辑不崩溃

### B.5 Mock AI 验收测试

- **文件** `tests/autopilot-repair.test.ts`
- **内容** 新增测试：AI 修复路径（mock provider）、正则→AI fallback、AI 失败不回退到已修改状态
- **验证** `npm test` 全部通过

---

## C. 测试自动化

### C.1 新建 Rollback E2E Smoke 脚本

- **文件** `scripts/rollback-smoke.mjs`（新建）
- **内容**
  - `ic init --force` → `ic scan`
  - `ic auto docs --go --auto` 写入文档后校验
  - 校验失败时自动回滚成功
  - `ic rollback --list` 确认快照已保存
  - 验证回滚后文件恢复到写入前状态
- **验证** 本地 `node scripts/rollback-smoke.mjs` 通过

### C.2 CI 新增 `rollback-acceptance` Job

- **文件** `.github/workflows/ci.yml`
- **内容** 在 test 之后新增 job：`rollback-acceptance`（ubuntu-latest），运行 `npm run test:acceptance` + `node scripts/rollback-smoke.mjs`
- **验证** CI 绿色通过

### C.3 异常路径测试

- **文件** `tests/autopilot-rollback.test.ts`
- **内容** 新增测试：
  - 快照 JSON 损坏 → `loadLatestAutopilotRollbackPlan()` 返回 null
  - 回滚时文件被外部进程删除 → receipts 中 action=skipped, ok=false
  - 快照目录不存在 → 返回空列表
  - 超多文件（50+）回滚性能验证
- **验证** `npm test` 全部通过

### C.4 真实 AI Rollback Smoke（可选）

- **文件** `scripts/rollback-live-smoke.mjs`（新建）
- **内容** 与 `rollback-smoke.mjs` 相同但使用真实 AI provider（需 API key）
- **触发** 仅当 `ANTHROPIC_API_KEY` 或 `DEEPSEEK_API_KEY` 存在时运行
- **验证** 有 key 时本地通过

---

## 执行记录

| 任务 | 状态 | 开始 | 完成 | 备注 |
|------|------|------|------|------|
| A.1 Memory onRollback | ✅ | 2026-05-20 | 2026-05-20 | runtime.ts + onRollback hook |
| A.2 Task rolled-back | ✅ | 2026-05-20 | 2026-05-20 | types.ts + task-engine.ts |
| A.3 Audit rollback | ✅ | 2026-05-20 | 2026-05-20 | types.ts AuditAction + audit.ts label |
| A.4 广播接入 | ✅ | 2026-05-20 | 2026-05-20 | index.ts broadcastRollback() |
| A.5 Execution Chain | ✅ | 2026-05-20 | 2026-05-20 | execution-chain.ts stage 更新 |
| B.1 AI 修复接入 | ⬜ | — | — | — |
| B.2 二级 Fallback | ⬜ | — | — | — |
| B.3 增加 AI 轮次 | ⬜ | — | — | — |
| B.4 超时回退 | ⬜ | — | — | — |
| B.5 Mock AI 测试 | ⬜ | — | — | — |
| C.1 E2E Smoke 脚本 | ⬜ | — | — | — |
| C.2 CI Job | ⬜ | — | — | — |
| C.3 异常路径测试 | ⬜ | — | — | — |
| C.4 真实 AI Smoke | ⬜ | — | — | — |
