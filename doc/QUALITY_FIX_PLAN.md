# 质量修复方案 — 开发逻辑/记忆/代码能力

## 2026-05-21 执行记录 — 程序员B FIX-03~06 收尾

本轮聚焦发布质量最后一公里：lint 全清零、CI 重构为三级流水线、macOS 补齐完整验证序列、降级消息统一中文分级格式。

### 已完成

| FIX | 问题 | 修复 | 验证 |
|-----|------|------|------|
| FIX-05 | `npm run lint` 残留 108 warnings | `eslint.config.mjs` 补 `varsIgnorePattern/caughtErrorsIgnorePattern/destructuredArrayIgnorePattern: '^_'`；31 源文件删除未用 import、前缀未用参数/局部变量；修复 `/* global */` 误触 ESLint 全局声明 | `eslint "src/**/*.ts"` → **0 problems** |
| FIX-03 | macOS CI 只跑 `build→smoke`，跳过 tsc/lint/test | `ci.yml` + `smoke.yml` smoke job 内为 `macos-latest` 新增条件步骤：build 后依次执行 tsc → lint → test → smoke → macos:acceptance | 工作流文件 YAML 验证通过 |
| FIX-04 | CI 无分层，quick 与 full 混跑 | 重构为三层：Tier 1 `quick`(tsc+lint) → Tier 2 `acceptance`(unit tests, Node 18/20/22) → Tier 3 `smoke`+`docker`+`ai-capability` | pipeline 依赖链正确，docker/ai gate 提前到 acceptance 解锁 |
| FIX-06 | 降级消息格式不统一，英文/中文混用 | 新增 `src/core/degradation.ts`：3 个严重级别、8 个场景函数、`formatDegrade/formatDegradeCompact/warnDegrade`；接入 index.ts 3 处 | tsc 通过，lint 0 warnings，格式统一 |

### 当前门禁基线

```
npx tsc --noEmit       # 通过（0 errors）
npm test               # 119 files / 1723 passed / 2 skipped（2026-05-21）
npm run lint           # 0 errors / 0 warnings  ← FIX-05 完成后达到
npm run release:trust  # warning budget 0/20，通过
```

### 后续建议

- `src/index.ts`（4400+ 行）、`src/cli/repl.ts`（3300+ 行）仍是最大维护风险，需持续按模块边界拆分；lint 清零消除了最大噪声，拆分窗口已到。
- 降级模块 `degradation.ts` 中的三个已接入点是起点，后续遇到 `warn('...')` 的降级场景应逐步迁移到 `formatDegrade()`，统一用户感知。
- CI Tier 2 acceptance 目前含 Node 18/20/22 矩阵，如 CI 时间预算紧张，可将 18/20 改为 weekly 调度，只保留 22 在 PR 路径。

---

## 2026-05-20 执行记录 — PRD 口径质量门禁闭环

本轮以 `docs/PRD.md` 为准，优先修复会直接影响“跨平台兼容、Memory Kernel 自动激活、CI/CD 质量门禁”的问题。

### 已完成

| 问题 | 修复 | 验证 |
|------|------|------|
| Windows 下测试硬编码 `/tmp` 导致权限失败 | `report-agent.test.ts` 改用 `os.tmpdir()` + `mkdtemp()` | report-agent 10/10 通过 |
| Memory Kernel 在 TS/Vitest ESM 路径下找不到 `./sqlite-store.js` | `store.ts` 直接引用 `SQLiteStore`，`sqlite-store.ts` 延迟加载 `node:sqlite` | memory/context 测试通过 |
| PRD 写运行时 `>=18.0.0`，但 SQLite 索引依赖 Node 24+ `node:sqlite` | SQLite 不可用时降级为 JSONL 情景日志 + `rules.json/tree.md` 语义记忆；情景查询从 JSONL 兜底读取 | storage/context/recall 定向测试通过 |
| SQLite 文件句柄未释放导致 Windows `EBUSY` | `resetMemoryRuntime()` 支持 await shutdown，context 测试清理前释放 runtime/store | context 3/3 通过 |
| Vitest 写 `node_modules/.vite/vitest/results.json` 权限失败 | `vitest.config.ts` 设置 `cache: false` | 定向测试退出码恢复 0 |
| Vitest `deps.external` 废弃告警 | 迁移到 `server.deps.external` | 无 deprecated warning |
| CLI 覆盖测试过慢 | `cli-full-coverage.test.ts` 共享 fixture，覆盖测试避免完整执行链 | 单文件约 316s → 38-52s |
| `node:sqlite` experimental warning 污染 CI 输出 | `npm test` 改为 `node --no-warnings ...`，Vitest 配置补 `NODE_OPTIONS` | 完整测试无 SQLite warning |
| `FINDSTR` 系统错误污染测试输出 | 跨平台命令测试准备真实目标文件 | 完整测试无 FINDSTR stderr |
| `scan` acceptance 断言依赖 stdout | 改为验证命令成功 + `.icloser/index.json` 存在 | acceptance pipeline 5/5 通过 |
| Coverage 阶段绕过项目脚本导致临时项目超时 | `runCoverageStage()` 改为复用 `resolveStageCommand()`，尊重 `coverage/test:coverage` 脚本和调用方 timeout | verifier coverage 64/64 通过；全量测试通过 |

### 当前门禁基线

```
npx tsc --noEmit       # 通过
npm test               # 116 files / 1715 passed / 2 skipped (2026-05-21)
npm run lint           # 0 errors / 9 warnings (2026-05-21)
```

### 后续建议

- 将 `npm test` 分层为 `test:unit`、`test:integration`、`test:acceptance`，CI PR 默认跑 quick gate，主分支/发布跑全量 acceptance。
- 随 `index.ts` / `repl.ts` / `ast-parser.ts` 拆分继续清理剩余 ESLint warnings，避免在巨石文件里做无上下文的大规模机械删除。
- 对 Memory Kernel 文档继续明确运行时策略：Node 18/20 下使用 JSONL/语义文件降级，Node 24+ 开启 SQLite 索引；不再需要把 PRD runtime 提升到 Node 24+。

---

## 问题诊断

### 问题1: 开发逻辑混乱

**现象**: 用户说"做iOS原生工程"，AI直接生成代码，跳过了所有中间步骤。

**根因**: `executeTask` 没有强制的工作流检查点。AI的自由度太高。

**正确流程**:
```
需求输入 → 分析(只读) → 生成设计文档 → 分解任务 → 
告知用户任务ID → 用户确认 → 逐任务开发 → 单元测试 → 验收
```

当前流程:
```
需求输入 → AI直接写代码 ❌
```

### 问题2: AI大脑上下文/记忆混乱

**现象**: "根据记忆，你此前要求我完成..." — 虚构了不存在的历史。

**根因**:
1. `assembleRelevantMemory()` 注入了未确认的记忆候选
2. 全局记忆注入没有验证相关性
3. REPL 对话历史没有按任务边界清晰分隔
4. 上下文窗口缺乏优先级排序（当前任务 vs 历史记忆）

### 问题3: AI代码能力弱 (30/100)

**根因**:
1. 不读存量代码就开始写 → 风格不一致
2. 没有强制测试生成 → 代码没验证
3. 单次生成无迭代优化 → 质量无保障
4. 没有代码审查阶段

---

## 修复方案 (不影响分析报告质量)

### FIX-1: 强制开发工作流 (修复问题1)

**新增**: `ic plan` 命令 — 结构化开发规划

```
ic plan "用户需求描述"
  │
  ├─ Phase 1: 需求分析 (只读，不写代码)
  │     → 写入 docs/PLAN-{id}.md
  │
  ├─ Phase 2: 任务分解
  │     → N个子任务，每个有ID/描述/预估/依赖
  │     → 用编号列表展示，等待用户确认
  │
  ├─ Phase 3: 用户确认后逐个执行
  │     Task-1: [开发] → [测试] → [验收]
  │     Task-2: [开发] → [测试] → [验收]
  │     ...
  │
  └─ Phase 4: 集成验收
```

**修改文件**: `src/index.ts` + `src/core/task-planner.ts` (新建)

### FIX-2: 记忆系统修复 (修复问题2)

**问题2.1**: 全局记忆注入未过滤无关内容
- 修改: `assembleGlobalMemoryHints()` 增加相关性阈值
- 只注入与当前任务关键词匹配度 > 0.5 的记忆

**问题2.2**: REPL 对话边界不清
- 修改: 每次任务完成/取消时添加 `--- 任务边界 ---` 标记
- 超过边界的对话历史权重降低

**问题2.3**: 虚构记忆
- 修改: 记忆注入时标注来源 (`[来源: 任务#xxx]`)
- AI prompt 中明确: "如果记忆中没有相关信息，说'无历史记录'，不要编造"

**修改文件**: `src/core/context.ts`, `src/core/memory.ts`

### FIX-3: 代码生成能力提升 (修复问题3)

**30→80+ 路线**:

| 阶段 | 改动 | 效果 |
|------|------|------|
| 生成前 | 强制读取 3-5 个现有源文件 | 风格匹配 |
| 生成前 | 读取 StyleFingerprint + 注入风格约束 | 命名/缩进/引号一致 |
| 生成后 | 自动运行 `ic gen test` 生成测试 | 测试覆盖 |
| 生成后 | 运行 verify → 失败则 `ic gen fix` | 自动修复 |
| 生成后 | diff 展示 → 用户确认 → 写入 | 审查确认 |

**修改文件**: `src/index.ts` (executeTask 增强), `src/core/code-writer.ts` (增强)

---

## 实现细节

### FIX-1: 强制工作流

```typescript
// 新增意图: 'plan' — 触发开发规划流程
// classifyIntentRegex 新增:
patterns: [
  /^(做|开发|实现|新建|创建|写|帮我做|帮我写).*(项目|应用|app|工程|功能)/,
]
category: 'plan' // 新类别

// handlePlan() 流程:
// 1. 分析需求 → 输出设计摘要
// 2. 分解为 N 个任务
// 3. 展示任务列表 + 编号
// 4. 用户输入 "开始 Task-1" → 逐个执行
```

### FIX-2: 记忆修复

```typescript
// assembleGlobalMemoryHints 增加相关性过滤:
function isMemoryRelevant(memory: string, taskDesc: string): boolean {
  const taskWords = taskDesc.toLowerCase().split(/\s+/);
  const memWords = memory.toLowerCase().split(/\s+/);
  const overlap = taskWords.filter(w => memWords.includes(w)).length;
  return overlap >= 2; // 至少2个词重叠
}

// 记忆注入添加来源标注:
parts.push(`[来源: 任务#${candidate.taskId}, ${candidate.createdAt}] ${candidate.summary}`);

// REPL 任务边界:
// 每次 AI 调用完成时追加: state.conversation.push({role:'system', content:'--- 任务边界 ---'});
```

### FIX-3: 代码生成增强

```typescript
// executeTask 的 code_change 路径:
// Before: AI生成 → 写入 → 验证
// After: 
//   1. 读取 StyleFingerprint
//   2. 注入风格约束到 systemPrompt
//   3. AI生成代码
//   4. 展示 diff → 用户确认
//   5. 写入文件
//   6. 自动生成测试 (ic gen test)
//   7. 运行验证
//   8. 失败 → ic gen fix → 重新验证
//   9. 通过 → 报告
```

## 质量保障 (不影响分析报告)

- 分析报告路径 (`isAnalysisOnlyTask`) 保持不变
- 上下文组装 (`assembleContext`) 不变
- 合成阶段不变
- 只在 `code_change` 意图路径增强
