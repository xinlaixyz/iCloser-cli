# AgentCode

## 概述

AgentCode — 基于 TypeScript 构建，定位是本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统。

- 语言：typescript
- 框架：无
- 构建系统：npm
- 测试框架：vitest
- 运行时：>=18.0.0

产品底线：具备 Claude Code 级代码能力，包括读代码库、跨文件修改、运行验证、解释 diff、失败后修复、回滚/提交；同时通过 Memory Kernel 形成跨会话、跨任务的项目级长期记忆。

源码文件：60+ 个 | 测试文件：119 个 | 测试基线：1723 passed / 2 skipped | Memory Kernel: 17 模块

## 快速开始

Windows:

```bash
cd D:\temp\Codex\AgentCode
npm run dev
npm run build
npm run test
```

macOS / Linux:

```bash
cd /path/to/AgentCode
npm ci
npm run build
npm test
npm run smoke:tools
npm run macos:acceptance
```

## 团队协作草稿

```bash
ic issue "Add login audit trail" --json
ic pr --title "Improve developer experience" --json
ic pr --task <task-id> --title "Ship task evidence" --json
ic commit-draft --json
ic diff explain
```

这些命令只生成本地计划和草稿，不会自动提交、推送或调用 GitHub API。`ic pr` 默认会尝试附加最近一次任务报告和验证日志，方便把验收证据带进团队协作。

## 发布信任门禁

```bash
npm run release:trust       # 快速本地门禁
npm run release:trust:full  # 发布前完整门禁
npm run smoke:golden        # Claude Code 替代品本地黄金路径 smoke
```

`release:trust` 会生成 `doc/release/TRUST_REPORT_YYYY-MM-DD.md`，并检查 warning budget；默认预算为 20，可用 `ICLOSER_WARNING_BUDGET=10` 或 `-- --warning-budget=10` 继续收紧。受限环境中可用 `-- --report-dir=<path>` 或 `ICLOSER_RELEASE_REPORT_DIR=<path>` 指定可写报告目录。

真实 Provider 黄金路径必须由 AI Provider 生成计划和代码变更。`npm run smoke:golden:real` 默认会拒绝 scripted fallback；如只想调试证据链，可显式运行 `node scripts/golden-path-real.mjs --allow-scripted-fallback --artifact-dir=<path>`，但该结果不能作为 G1 满分验收。

## 记忆文件

```bash
ic mem manifests
ic mem edit
ic mem used "修复登录测试"
ic mem why <id-or-keyword>
ic mem import
ic mem recall "测试前需要做什么"
ic mem export AGENTS.md
```

AgentCode 支持把 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`.cursor/rules` 导入 Semantic Memory，并可导出项目规则到 `AGENTS.md`，用于对齐 Codex / Claude Code 类工具的项目级记忆习惯。

## 项目结构

> 由 iCloser autopilot 自动生成，运行 `ic autopilot` 刷新。

## 文档索引

- [PRD](PRD.md) — 产品需求文档
- [ARCHITECTURE](ARCHITECTURE.md) — 架构设计
- [MEMORY_KERNEL](MEMORY_KERNEL.md) — **Memory Kernel v1.0 完整文档** (认知记忆核心)
- [PROJECT_ANALYSIS](PROJECT_ANALYSIS.md) — **项目完成度分析报告** (2026-05-20)
- [CAPABILITY_ASSESSMENT](../doc/CAPABILITY_ASSESSMENT.md) — **关键能力综合评分** (AI记忆/工具/代码/测试/架构)
- [OVERALL_REANALYSIS](../doc/OVERALL_REANALYSIS_2026-05-20.md) — 按“本地工程执行器 + Claude Code替代品 + 长期记忆”重新分析
- [OVERALL_ACCEPTANCE_REANALYSIS_2026-05-21](../doc/OVERALL_ACCEPTANCE_REANALYSIS_2026-05-21.md) — **最新** 整体验收与重新分析
- [MACOS_ACCEPTANCE_STANDARD](../doc/MACOS_ACCEPTANCE_STANDARD_2026-05-20.md) — macOS 顺畅度验收标准
- [ARCHITECT_ACCEPTANCE_DEV2_TOOL_PLAN](../doc/ARCHITECT_ACCEPTANCE_DEV2_TOOL_PLAN_2026-05-20.md) — 架构验收记录与程序员2工具能力任务书
- [USAGE_MARKET_ACCEPTANCE](../doc/USAGE_MARKET_ACCEPTANCE_2026-05-20.md) — 用户视角与市场需求验收报告
- [CODEX_CLAUDE_MEMORY_ALIGNMENT](../doc/CODEX_CLAUDE_MEMORY_ALIGNMENT.md) — Codex / Claude Code 对标与记忆功能方案
- [DEVELOPER_GUIDE](DEVELOPER_GUIDE.md) — 开发者指南
- [API](API.md) — 接口文档 (CLI + 模块导出)
- [TESTING](TESTING.md) — 测试说明
- [CHANGELOG](../CHANGELOG.md) — 变更日志
