# AgentCode -- 测试说明

## 测试策略

当前项目采用分层测试策略：
- **单元测试** (vitest)：覆盖核心模块（35+ 测试文件，覆盖扫描器、任务引擎、AI 输出协议、验证器、内存系统、审计、安全、Agent 管理器等）
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

### 单元测试（37 个文件）

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

## 测试覆盖目标

源码文件 42 个（不含 scanner-worker.ts），分布在 8 个模块中。
已有 37 个单元测试文件 + 18 个 smoke 脚本。

运行 `ic auto tests` 查看覆盖缺口。

### 当前覆盖范围
- CLI 命令路由（index.ts 中所有 25+ 命令）
- 任务引擎（创建、调度、文件锁定、状态管理）
- 扫描器（全量扫描、增量扫描、指纹计算、增量合并）
- AI 输出协议（解析、验证、格式化）
- Provider 管理（创建、状态、Key 推断）
- Agent 管理器（创建、启动、暂停、恢复、停止、编排、沙箱）
- 记忆系统（读写、候选、审核、搜索）
- 安全规则（定义、检查、禁用/启用）
- 验证器（编译/测试/lint 验证管线）
- 审计日志（事件记录、加载、脱敏）

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
- 文件系统操作使用临时目录（通过 `fs-extra` 的 `ensureDir`/`remove`）
- Git 操作使用 `isGitRepo` 检测，必要时创建临时 Git 仓库
- 内存系统测试避免写入真实 `.icloser` 目录

### CI 集成要求
- 所有 PR 必须通过 PR Check Gate（tsc + lint + test）
- 跨平台兼容：smoke 测试在 Windows、macOS、Ubuntu 上均需通过
- 测试超时：默认 10 秒，smoke 测试 120 秒
- 禁止使用真实 API Key：所有测试使用 mock provider

---

> 本文档由 iCloser autopilot 自动生成草稿。
