# AgentCode

## 概述

AgentCode — 基于 TypeScript 构建，定位是本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统。

- 语言：typescript
- 框架：无
- 构建系统：npm
- 测试框架：vitest
- 运行时：>=18.0.0

产品底线：具备 Claude Code 级代码能力，包括读代码库、跨文件修改、运行验证、解释 diff、失败后修复、回滚/提交；同时通过 Memory Kernel 形成跨会话、跨任务的项目级长期记忆。

源码文件：57+ 个 | 测试文件：112 个 | 测试基线：1640 passed / 2 skipped | Memory Kernel: 17 模块

## 快速开始

```bash
cd D:\temp\Codex\AgentCode
npm run dev
npm run build
npm run test
```

## 记忆文件

```bash
ic mem manifests
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
- [ARCHITECT_ACCEPTANCE_DEV2_TOOL_PLAN](../doc/ARCHITECT_ACCEPTANCE_DEV2_TOOL_PLAN_2026-05-20.md) — 架构验收记录与程序员2工具能力任务书
- [USAGE_MARKET_ACCEPTANCE](../doc/USAGE_MARKET_ACCEPTANCE_2026-05-20.md) — 用户视角与市场需求验收报告
- [CODEX_CLAUDE_MEMORY_ALIGNMENT](../doc/CODEX_CLAUDE_MEMORY_ALIGNMENT.md) — Codex / Claude Code 对标与记忆功能方案
- [DEVELOPER_GUIDE](DEVELOPER_GUIDE.md) — 开发者指南
- [API](API.md) — 接口文档 (CLI + 模块导出)
- [TESTING](TESTING.md) — 测试说明
- [CHANGELOG](../CHANGELOG.md) — 变更日志
