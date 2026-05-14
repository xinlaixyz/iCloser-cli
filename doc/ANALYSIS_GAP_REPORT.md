# 分析能力差距报告

## 对比基准

同一项目 `D:\temp\Codex\icloser-forge`，同一模型 (DeepSeek)，相同环境。

| 维度 | 对比工具 | iCloser |
|------|---------|---------|
| 工具调用 | **179 次** (3 Agent 并行) | **~10 次** (1 Agent 串行) |
| Agent 并行 | **3 Agent 同时跑** | 代码已支持，实测未触发合成路径 |
| 输出格式 | **表格** (┌──┬──┐) + 分类 | 段落式 Markdown |
| 定量指标 | **具体数字** (157 tests, 19/20, 30/30) | 定性描述 |
| 版本追踪 | **V0.7 RC → V1.0** 路线图 | 无 |
| 阻塞项 | **task-029/task-030** 具体任务ID | 无 |
| 完成度评分 | **95% 代码 / 60-70% 测试** 分层评分 | 单一百分比 |
| 债务分级 | **高/中/低** 严重度 | 无 |
| 模块级分析 | **逐模块列举** (哪些缺测试) | 概括性描述 |

---

## 根因分析：7 个断层

### 断层 1：上下文缺少量化数据

**现象**：对比工具提取了 157 tests、32 文件、19/20 命令、30/30 模块等精确数字。iCloser 没有。

**根因**：`assembleProjectMeta()` 注入了 README、依赖列表、文件清单，但缺少：
- `package.json` 的 `scripts` / `version` / `devDependencies` 统计
- 测试文件数量（需扫描 `tests/`、`*.test.*`、`*.spec.*` 并计数）
- CLI 命令数量（需解析 Commander 注册）
- 模块完整性检查（import/export 断裂检测）

**在哪个文件**：`src/core/context.ts` → `assembleProjectMeta()` / `buildFileManifest()`

### 断层 2：不读取任务/报告文件

**现象**：对比工具读取了 `.icloser/tasks/` 下的任务文件，发现 task-029/task-030 阻塞 V0.7。

**根因**：iCloser 的上下文组装只读 `index.json` 和 `memory.json`，**不读任务目录**。
任务文件包含 `status`、`blocking` 等字段，是完成度评估的关键数据源。

**在哪个文件**：`src/core/context.ts` → `assembleContextFromProject()`

### 断层 3：不检查工程基础设施

**现象**：对比工具检查了 CI/CD (`.github/workflows`)、Linter (`.eslintrc`)、测试框架 (`package.json` scripts)。

**根因**：iCloser 的上下文没有 "工程健康检查" 维度：
- CI/CD 配置存在性
- Linter/Formatter 配置存在性
- 测试框架依赖检测
- Git 仓库状态
- `release/` `dist/` `build/` 等构建产物是否误提交

**在哪个文件**：`src/core/context.ts` → 需新增 `assembleEngineeringHealth()`

### 断层 4：输出无结构化模板

**现象**：对比工具输出有清晰的表格、分层、评级。iCloser 是自由段落。

**根因**：合成 prompt 只说 "写入 ANALYSIS.md"，**未提供输出模板**。
对比工具有内置的分析报告骨架：
```
## 项目概况 (表格)
## 代码完成度 (百分比 + 模块计数)
## 测试覆盖度 (文件数 + 通过数 + 缺失清单)
## 架构债务 (表格: 问题/严重度/说明)
## 路线图进度 (版本里程碑)
## 综合评估 (编号列表)
```

**在哪个文件**：`src/index.ts` → 合成 prompt (第 2158 行附近)

### 断层 5：并行 Agent 未充分利用

**现象**：代码已支持 3 Agent 并行（#61），但实测中 orchestration 走的是 mock provider 路径，没有真正用 AI 执行。

**根因**：`AgentManager.orchestrate()` 调用 `orchestrator.start()` 后 `waitForAgent` 只等 90 秒。
Mock provider 直接返回，但 DeepSeek provider 可能需要更长时间。
且 3 Agent 各自独立探索，结果没有交叉验证。

**在哪个文件**：`src/index.ts` → 第 2052 行 `isAnalysis` 并行探索块

### 断层 6：增量扫描未带入历史数据

**现象**：增量扫描跳过了 1186 个未变更文件，这是好的。但历史任务数据、上一次分析报告没有被注入上下文。

**根因**：增量扫描只跳过文件读取，**不保留历史分析结果**。
如果上次分析发现 "task-012 审查视图 11 轮迭代仍 NEED_FIX"，
这次应该自动注入这个结论。

**在哪个文件**：`src/core/scanner.ts` → `computeFingerprints()`

### 断层 7：没有可视化输出

**现象**：对比工具有 ┌──┬──┐ 表格边框。iCloser 只有 Markdown 列表。

**根因**：合成 prompt 未要求表格格式，终端输出也未渲染 ANSI 表格。
iCloser 的 `output.ts` 已有 `table()` 函数支持 ANSI 表格，
但分析报告是 Markdown 文件，未使用终端渲染。

**在哪个文件**：`src/cli/output.ts` → `table()` 函数

---

## 修复状态 (2026-05-15)

| 优先级 | 断层 | 状态 | 改动 |
|--------|------|------|------|
| 🔴 P0 | #4 结构化模板 | ✅ 完成 | index.ts 合成 prompt: 表格+评分+分层模板 |
| 🔴 P0 | #1 量化数据 | ✅ 完成 | context.ts `collectProjectMetrics()`: 文件数/模块数/导出数/测试数/版本/scripts |
| 🟡 P1 | #2 读任务文件 | ✅ 完成 | context.ts `readTaskStatusSummary()`: 读取 .icloser/tasks 状态 |
| 🟡 P1 | #3 工程健康检查 | ✅ 完成 | context.ts `checkEngineeringHealth()`: CI/Lint/Test/Git/TS strict |
| 🟡 P1 | #5 并行 Agent | ✅ 完成 | index.ts: 3 Agent × explore × 120s timeout × 8000 tokens |
| 🟢 P2 | #6 历史数据 | ✅ 完成 | context.ts: 注入上次 .icloser/analysis-report.md 关键行 |
| 🟢 P2 | #7 可视化 | ✅ 完成 | 合成模板生成 Markdown 表格，保存至 analysis-report.md 供增量 |

## 对比工具的实际工作流（逆向分析）

```
阶段 1: 结构探索 (Explore agent, 40 tools, 66.9k tokens, 2m23s)
  ├─ list directory tree
  ├─ read package.json, tsconfig.json, README.md
  ├─ count files by extension (.ts, .js, .json)
  ├─ map module structure (src/core, src/cli, src/ide)
  └─ identify tech stack

阶段 2: 并行深度分析 (3 Explore agents)
  ├─ Agent A: 任务完成度 (66 tools, 63k tokens)
  │   ├─ read .icloser/tasks/*.json
  │   ├─ check task status (done/failed/blocked)
  │   ├─ read reports
  │   └─ find blocking issues
  ├─ Agent B: 测试完整性 (49 tools, 40k tokens)
  │   ├─ count test files
  │   ├─ check test framework config
  │   ├─ read test file contents
  │   └─ identify missing test coverage
  └─ Agent C: IDE/CLI 完整性 (24 tools, 56k tokens)
      ├─ count CLI commands
      ├─ check IDE architecture
      ├─ verify import/export chains
      └─ check CI/CD config

阶段 3: 综合 (main agent)
  └─ 汇总 3 Agent 结果 → 结构化报告 (表格+评分+路线图)
```
