# AgentCode -- 测试说明

## 测试策略

当前项目采用分层测试策略：
- **单元测试** (vitest)：覆盖核心模块（112 个测试文件，覆盖扫描器、任务引擎、AI 输出协议、验证器、内存系统、审计、安全、Agent 管理器等）
- **Smoke 测试** (18 个独立脚本)：端到端验证发布质量，覆盖安装、REPL 交互、多语言支持、Agent 执行、Web 搜索、自动修复等场景
- **CI/CD 集成**：GitHub Actions 自动运行，PR 门禁 + 多平台矩阵

## 测试框架

检测到测试框架：vitest v2

所有测试位于 `tests/` 目录，使用 vitest runner：
- 测试文件命名：`*.test.ts`
- 运行器配置：`vitest.config.ts`（若存在）

## 运行测试

```bash
# 运行全部单元测试
npm test

# 持续监视模式
npm run test:watch

# 运行特定测试文件
npx vitest run tests/scanner.test.ts

# 带覆盖率报告
npx vitest run --coverage

# 发布 smoke 测试
npm run smoke           # 基础发布验证
npm run smoke:all       # 完整 smoke 套件
npm run smoke:agent     # Agent 相关测试
npm run smoke:repl      # REPL 交互测试
npm run smoke:web-search # 网络搜索测试
```

## 测试文件清单

### 单元测试（112 个文件，下表列出全部核心文件及本轮新增文件）

| 测试文件 | 覆盖模块 |
|----------|----------|
| `tests/agent-manager.test.ts` | Agent 管理器 |
| `tests/agent-sandbox.test.ts` | Agent 沙箱 |
| `tests/ai-output-contract.test.ts` | AI 输出协议 |
| `tests/ast-parser.test.ts` | AST 解析器 |
| `tests/audit.test.ts` | 审计系统 |
| `tests/autodoc.test.ts` | 自动文档 |
| `tests/autopilot-repair.test.ts` | 自动修复 |
| `tests/autopilot-rollback.test.ts` | 自动回滚 |
| `tests/autopilot-router.test.ts` | 自动路由 |
| `tests/autopilot-verify.test.ts` | 自动验证 |
| `tests/autopilot.test.ts` | 自动分析 |
| `tests/autotest.test.ts` | 自动测试 |
| `tests/choice-panel.test.ts` | 选择面板 |
| `tests/context.test.ts` | 上下文组装 |
| `tests/detect.test.ts` | 项目检测 |
| `tests/execution-chain.test.ts` | 执行链 |
| `tests/first-run.test.ts` | 首次运行 |
| `tests/format-status.test.ts` | 格式化 |
| `tests/json-contract-spawn.test.ts` | JSON 契约 |
| `tests/json-contract.test.ts` | JSON 契约 |
| `tests/loop-panel.test.ts` | 循环面板 |
| `tests/memory.test.ts` | 记忆系统 |
| `tests/output-fallback.test.ts` | 输出回退 |
| `tests/provider.test.ts` | AI Provider |
| `tests/repl-completer.test.ts` | REPL 补全 |
| `tests/report-gate.test.ts` | 报告门禁 |
| `tests/scanner-s10.test.ts` | 扫描器 S10 |
| `tests/scanner.test.ts` | 扫描器 |
| `tests/security.test.ts` | 安全规则 |
| `tests/skill-manager.test.ts` | Skill 管理器 |
| `tests/system-approval.test.ts` | 系统审批 |
| `tests/system-runner.test.ts` | 系统执行 |
| `tests/task-engine.test.ts` | 任务引擎 |
| `tests/task-loop.test.ts` | 任务循环 |
| `tests/tool-registry.test.ts` | 工具注册表 |
| `tests/verifier.test.ts` | 验证器 |
| `tests/dev1-acceptance.test.ts` | 验收测试 |
| `tests/acceptance/rollback.test.ts` | 回滚验收（快照→持久化→回滚→验证） |
| `tests/acceptance/codegen.test.ts` | 代码生成验收（mock AI） |
| `tests/acceptance/pipeline.test.ts` | 管线验收（init→scan→plan→doctor） |

### 覆盖率专项测试（本轮新增，11 个文件）

本轮为提升语句覆盖率从 ~55.92% → 60.02% 而新增，专门针对此前零覆盖或低覆盖的代码路径。

| 测试文件 | 覆盖模块 / 目标行号 |
|----------|---------------------|
| `tests/task-engine-extra.test.ts` | 任务引擎深度覆盖：`cancelTask`、`scheduleTasks`、`generatePlan` 关键词分解、`completeTaskLoop`、`addFileChange`、`advanceTaskLoopState`（32 个用例） |
| `tests/code-writer-extra.test.ts` | 代码生成器：`getTestFilePath`、`findSymbolReferences`、`generateWithVerifyLoop`（早返回 + 异常）、`detectEmptyTests`、`scanGeneratedTests`（21 个用例） |
| `tests/misc-coverage.test.ts` | `memdbg`（summary/reset/error/warn/info）、`runToolLoop`（无参数/字符串参数）、`addPitfall`、`recordTaskError`、`AgentManager` 广播与子任务树（20 个用例） |
| `tests/ast-parser-impact.test.ts` | AST 解析器 `analyzeImpact`（直接/间接影响、深度 BFS、循环图）、`analyzeCrossFileDataFlow` 传播（11 个用例） |
| `tests/manager-sandbox.test.ts` | Agent 管理器沙箱控制：`checkSandboxWrite`（none/readonly/isolated）、`filterSandboxedFiles` 路径遍历防护（9 个用例） |
| `tests/security-output-extra.test.ts` | `getEffectiveMode`、`scanTaskSecurity`（敏感文件检测/去重）、`spinner`、`printProjectIdentity`（版本行隐藏）、`JSONLStore.clear()`/`rotateIfNeeded()`（15 个用例） |
| `tests/autopilot-extra.test.ts` | `verifyAutopilotTests` pass/fail/skip 路径、私有函数 `summarizeOutput`/`bufferToString` 间接覆盖（3 个用例） |
| `tests/working-memory-extra.test.ts` | 工作记忆：`mergeErrors`（>3 错误触发合并）、`saveToDisk`/`loadFromDisk` 快照持久化、`extractForEpisodic`（6 个用例） |
| `tests/task-memory-extra.test.ts` | `inferIntent` 分支（test_gen/doc_gen/refactor/security/general/code_change）、`MAX_RECORDS` 溢出截断、`getTaskSuggestions`（9 个用例） |
| `tests/final-coverage.test.ts` | `checkRollback`（pass 路径）、`checkGit`（dirty/clean）、`writeFiles` 错误路径、`readFileChunks`、`archiveEpisodes`、`cleanup` sqlite 分支（9 个用例） |
| `tests/config-coverage.test.ts` | 配置管理：`setAIProvider`、`saveConfig`/`loadConfig`、配置验证与合并（覆盖 src/config/ 低覆盖分支） |

### Smoke 测试（18 个脚本）

| 脚本 | 描述 |
|------|------|
| `scripts/release-smoke.mjs` | 发布 smoke 主测试 |
| `scripts/full-smoke.mjs` | 完整 smoke 套件 |
| `scripts/first-run-smoke.mjs` | 首次运行 |
| `scripts/real-project-smoke.mjs` | 真实项目测试 |
| `scripts/repl-first-run-smoke.mjs` | REPL 首次运行 |
| `scripts/repl-init-refresh-smoke.mjs` | REPL 初始化刷新 |
| `scripts/repl-beginner-e2e-smoke.mjs` | REPL 端到端 |
| `scripts/agent-smoke.mjs` | Agent 执行 |
| `scripts/autopilot-smoke.mjs` | 自动分析 |
| `scripts/autopilot-repair-smoke.mjs` | 自动修复 |
| `scripts/loop-tool-smoke.mjs` | 循环工具 |
| `scripts/memory-event-smoke.mjs` | 记忆事件 |
| `scripts/multilang-smoke.mjs` | 多语言支持 |
| `scripts/web-search-smoke.mjs` | 网络搜索 |
| `scripts/check-lint.mjs` | Lint 检查 |

### 下一阶段工具能力验收

程序员2继续补工具能力时，必须以 `doc/ARCHITECT_ACCEPTANCE_DEV2_TOOL_PLAN_2026-05-20.md` 为准。阶段内最低门禁：

```bash
npx vitest run tests/tool-executor.test.ts tests/tool-executor-extra.test.ts tests/tool-loop.test.ts tests/tool-registry.test.ts
npx tsc --noEmit
npm run lint
```

完成 `scripts/tool-capability-smoke.mjs` 后，补充 `npm run smoke:tools` 作为工具层快速验收。

## 测试覆盖目标

源码文件 42 个（不含 scanner-worker.ts），分布在 8 个模块中。
已有 112 个单元测试文件 + 18 个 smoke 脚本，共 1640 个通过测试用例（2 个跳过，0 个失败）。

运行 `ic auto tests` 查看覆盖缺口。

### 当前覆盖率（2026-05-20）

| 指标 | 数值 |
|------|------|
| 语句覆盖率 | **60.02%**（17028 / 28370） |
| 测试用例数 | 1640 通过，2 跳过，0 失败 |
| 测试文件数 | 112 个（含 3 个 acceptance） |
| 前次基准 | ~55.92% |
| 本轮净增 | +4.10 个百分点（+1165 语句） |

### 当前覆盖范围
- CLI 命令路由（index.ts 中所有 25+ 命令）
- 任务引擎（创建、调度、取消、文件锁定、状态管理、generatePlan 关键词分解）
- 扫描器（全量扫描、增量扫描、指纹计算、增量合并）
- AI 输出协议（解析、验证、格式化）
- Provider 管理（创建、状态、Key 推断）
- Agent 管理器（创建、启动、暂停、恢复、停止、编排、沙箱写入控制、路径遍历防护）
- 记忆系统（读写、候选、审核、搜索、工作记忆压缩/持久化、任务记忆意图分类）
- 安全规则（定义、检查、禁用/启用、敏感文件去重检测）
- 验证器（编译/测试/lint 验证管线、自动验证 pass/fail/skip 路径）
- 审计日志（事件记录、加载、脱敏）
- AST 解析器（影响分析 BFS、跨文件数据流传播）
- 遗忘引擎（archiveEpisodes、cleanup sqlite 分支）
- 门禁检查器（rollback pass、git dirty/clean）
- 文件工具（writeFiles 错误路径、readFileChunks 分块读取）
- 配置管理（setAIProvider、saveConfig/loadConfig、配置验证）

## CI 集成

CI/CD 通过 GitHub Actions 执行（`.github/workflows/smoke.yml`）：

1. **PR Check Gate** (ubuntu-latest):
   - `npx tsc --noEmit` — 编译检查
   - `npm run lint` — Lint 检查
   - `npm test` — 单元测试

2. **Multi-platform Smoke** (ubuntu / macos / windows):
   - `npm run build` — 构建
   - `npm run smoke` — 发布 smoke 测试
   - Node 版本：22
   - 使用 npm 缓存加速依赖安装

## 编写测试规范

### 测试文件位置
- 单元测试放置于 `tests/` 目录
- 命名：`<module-name>.test.ts`
- Smoke 测试放置于 `scripts/` 目录
- 命名：`<scenario>-smoke.mjs`

### 命名规范
- 测试用例使用中文描述（项目面向中文用户）
- describe 描述模块名，it 描述具体行为
- Mock Provider 使用 `'mock'` 类型，无需 API Key

### Mock 策略
- AI Provider 测试使用 `mock` provider（离线，无需 API Key）
- 文件系统操作使用临时目录（`mkdtemp(join(tmpdir(), 'prefix-'))` + `afterEach(rm(dir, { recursive: true, force: true }))`）
- Git 操作使用 `isGitRepo` 检测，必要时创建临时 Git 仓库（`execSync('git init', { cwd: tmpDir })`）
- 内存系统测试避免写入真实 `.icloser` 目录
- `ForgettingEngine` 使用 mock store：`{ paths, archiveFile: async () => 'path', sqlite: { isOpen: true, deleteByKey } }`
- AI 调用链测试使用 mock provider：`{ chat: async (_p: any) => ({ content: '...', tokensUsed: 50 }) }`

### 关键 API 注意事项（避免重踩坑）

| 模块 | 正确用法 | 常见错误 |
|------|----------|----------|
| `WorkingMemory` | `new WorkingMemory()` → `wm.setTask(id, desc)` | ~~`new WorkingMemory(taskId)`~~（构造器不接受 taskId） |
| `WorkingMemory` | `wm.getByType('error')` 获取层 | ~~`wm.getLayers()`~~（方法不存在） |
| `WorkingMemory` | `wm.compress()` 触发 `mergeErrors`（需 >3 个 error） | 只有 ≤3 个错误时 mergeErrors 提前返回 |
| `inferIntent` | `code_change` 分支最先匹配（含 `修改\|创建\|写\|改\|加` 等 13 个关键词） | 测试其他分支时需确保描述不含上述关键词 |
| `readFileChunks` | `for await (const chunk of readFileChunks(path, size))` | chunkSize 为字节数，建议 <文件大小 以产生多个 chunk |
| `verifyAutopilotTests` | 用 `node --version`（pass）/`node -e "process.exit(1)"`（fail）测试私有函数 | 含 npm/vitest/jest 关键词的命令会被 `shouldSkipForMissingDependencies` 拦截 |

### CI 集成要求
- 所有 PR 必须通过 PR Check Gate（tsc + lint + test）
- 跨平台兼容：smoke 测试在 Windows、macOS、Ubuntu 上均需通过
- 测试超时：默认 10 秒，smoke 测试 120 秒
- 禁止使用真实 API Key：所有测试使用 mock provider

---

> 本文档由 iCloser autopilot 自动生成草稿，覆盖率专项章节由工程师手动补充（最后更新：2026-05-20，覆盖率 60.02%）。
