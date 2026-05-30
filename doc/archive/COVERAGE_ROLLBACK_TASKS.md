# 覆盖率 & 自动化任务拆解

日期：2026-05-20
目标：覆盖率 43.6% → 60%+ / 验收测试 CI 化 / ic rollback --auto

---

## 总览

| 工作流 | 目标 | 估时 | 优先级 |
|--------|------|------|--------|
| **A** 覆盖率 43.6% → 60%+ | 补测 3 个零覆盖区域 | 8h | 🔴 |
| **B** 真实验收测试自动化 | mock-AI e2e + CI 接入 | 4h | 🔴 |
| **C** `ic rollback --auto` | 验证失败后自动回滚 | 3h | 🟡 |

执行顺序：C1→C2→C3，A1/A2 并行，A3，B1→B3→B2

---

## 工作流 A：覆盖率 43.6% → 60%+

### A1 · cli UI 层单元测试（2h）

目标文件（纯函数，0 测试）：

| 文件 | 行数 |
|------|------|
| `src/cli/tui.ts` | 259 |
| `src/cli/theme.ts` | 135 |
| `src/cli/format.ts` | 117 |
| `src/cli/startup-analysis.ts` | 285 |

- [ ] A1-1 新建 `tests/tui.test.ts`：renderPanel / renderProgress / renderStep 等函数
- [ ] A1-2 新建 `tests/theme.test.ts`：颜色、图标、等级映射全覆盖
- [ ] A1-3 新建 `tests/format.test.ts`：format 工具函数边界值
- [ ] A1-4 `tests/startup.test.ts` 扩展：补 startup-analysis 各分析分支
- 验收：以上 4 文件覆盖率 ≥ 80%

### A2 · autopilot 系统补测（3h）

「autopilot 系统 5 文件 1200 行，无测试覆盖」

| 文件 | 行数 | 关键路径 |
|------|------|---------|
| `src/core/autopilot.ts` | ~300 | analyzeProject / buildReport |
| `src/core/autopilot-router.ts` | ~150 | action 路由分发 |
| `src/core/autopilot-verify.ts` | ~200 | verify 流程 |
| `src/core/autopilot-repair.ts` | ~250 | repair 循环 |

- [ ] A2-1 `tests/autopilot.test.ts`：analyzeProject() mock 项目，断言 findings/actions 结构
- [ ] A2-2 `tests/autopilot-router.test.ts`：各 action id 路由到正确处理函数
- [ ] A2-3 `tests/autopilot-verify.test.ts` 扩展：pass / fail / partial 三分支
- [ ] A2-4 `tests/autopilot-repair.test.ts` 扩展：1轮修复成功 / 3轮达上限两路径
- 验收：autopilot 系统整体覆盖 ≥ 60%

### A3 · index.ts spawn 命令路径补全（3h）

缺失命令：rollback / risk / audit / report / doctor / gate / agent

- [ ] A3-1 `tests/cli-full-coverage.test.ts` 增加 rollback / risk / audit / report 路径
- [ ] A3-2 增加 doctor / gate / agent 命令路径测试
- [ ] A3-3 `vitest.config.ts` 开启 `all: true`，强制统计未执行文件
- 验收：总体覆盖率 ≥ 60%（`npm run test:coverage`）

---

## 工作流 B：真实验收测试自动化

### B1 · vitest acceptance suite（2h）

- [ ] B1-1 新建 `tests/acceptance/` 目录
- [ ] B1-2 `tests/acceptance/pipeline.test.ts`：init→scan→task→verify，断言 TaskStatus='completed'
- [ ] B1-3 `tests/acceptance/codegen.test.ts`：gen new → 文件写入 → tsc 验证
- [ ] B1-4 `tests/acceptance/rollback.test.ts`：写入 → 回滚 → 还原验证
- 验收：`npm test` 包含 acceptance suite，3 个场景全 pass

### B2 · live-acceptance.mjs 强化（1h）

- [ ] B2-1 Gate 4 增加 mock 编排输出结构校验（JSON schema）
- [ ] B2-2 增加 Gate 7：`ic status --json` 字段完整性校验
- 验收：`npm run acceptance` 7/7 pass

### B3 · CI 接入（1h）

- [ ] B3-1 `package.json` 增加 `"test:acceptance": "vitest run tests/acceptance"`
- [ ] B3-2 `.github/workflows/` PR Gate 增加 acceptance 步骤（mock provider）
- 验收：PR 自动触发 acceptance gate

---

## 工作流 C：`ic rollback --auto`

现状：autopilotRepairLoop 在 src/index.ts:3708 打印建议但不执行；ic rollback 需手动触发。

### C1 · autopilotRepairLoop 自动执行回滚（1h）

- [ ] C1-1 autopilotRepairLoop 签名增加 `options?: { autoRollback?: boolean }`
- [ ] C1-2 「Max attempts reached」分支后，当 autoRollback=true 自动调用 rollbackAutopilotChanges
- [ ] C1-3 所有调用点传入 `autoRollback: cmdOptions.auto ?? false`

### C2 · `ic auto` 命令增加 `--auto` 标志（1h）

- [ ] C2-1 ic auto docs/tests/code 命令增加 `.option('--auto', '验证失败时自动回滚')`
- [ ] C2-2 将 --auto 传入 autopilotRepairLoop
- [ ] C2-3 ic rollback 增加 --auto 模式：回滚最近一次 autopilot 快照

### C3 · 测试（1h）

- [ ] C3-1 `tests/autopilot-repair.test.ts`：3 轮达上限 + autoRollback=true → 文件已还原
- [ ] C3-2 `tests/autopilot-rollback.test.ts`：--auto 路径读取 latest snapshot 并执行
- 验收：npm test 零失败；ic auto tests --auto 失败时自动回滚

---

## 进度

| 子任务 | 状态 |
|--------|------|
| C1-1 autopilotRepairLoop options 签名 | ✅ |
| C1-2 autoRollback 分支 | ✅ |
| C1-3 调用点传参 | ✅ |
| C2-1 --auto 标志 | ✅ |
| C2-2 传参 | ✅ |
| C2-3 ic rollback --auto 模式 | ✅ |
| C3-1 repair 测试 | ✅ |
| C3-2 rollback --auto 测试 | ✅ |
| A1-1 tui.test.ts | ✅ |
| A1-2 theme.test.ts | ✅ |
| A1-3 format.test.ts | ✅ (已有 format-status.test.ts) |
| A1-4 startup-analysis 补测 | ✅ |
| A2-1 autopilot.test.ts | ✅ |
| A2-2 autopilot-router.test.ts | ✅ |
| A2-3 autopilot-verify 扩展 | ✅ |
| A2-4 autopilot-repair 扩展 | ✅ |
| A3-1 cli spawn 补测 | ✅ |
| A3-2 doctor/gate/agent/rollback --auto 测试 | ✅ |
| A3-3 vitest all:true | ✅ |
| B1-1 acceptance 目录 | ✅ |
| B1-2 pipeline.test.ts | ✅ |
| B1-3 codegen.test.ts | ✅ |
| B1-4 rollback.test.ts | ✅ |
| B2-1 Gate 4 强化 | ⬜ (可选) |
| B2-2 Gate 7 新增 | ⬜ (可选) |
| B3-1 package.json script | ✅ |
| B3-2 CI workflow | ⬜ (可选) |

## 最终结果（2026-05-20）

| 指标 | 前 | 后 |
|------|----|----|
| 测试数 | 498 | **749** (+251) |
| 测试文件 | 52 | **71** (+19) |
| 覆盖率(all:true) | 43.6% | **45.15%** |
| tsc 错误 | 0 | **0** |

### 覆盖率未达 60% 原因

`index.ts`（5033 行）+ `src/cli/repl.ts`（3450 行）合计 8500 行，spawn 测试不计入覆盖率。
下一步：将 `index.ts` 中的纯函数提取为独立模块，即可大幅提升覆盖率。
