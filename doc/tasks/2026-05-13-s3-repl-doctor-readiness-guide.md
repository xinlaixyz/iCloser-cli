# S3.8 REPL Doctor Readiness Guide

日期：2026-05-13
负责人：dev2

## 背景

S3.7 优化了 `ic doctor` 的新手下一步引导，但用户进入 REPL 后不一定知道要退出再运行命令。需要在 REPL 内提供同等的 readiness guide。

## 变更

- `src/cli/repl.ts`
  - 新增 `/doctor` slash command
  - 输出项目初始化、Provider、索引、Ready 状态
  - 按 REPL 场景给下一步：`/init`、粘贴 API Key 或 `/apikey`、`/scan`、直接输入需求
  - Tab 补全加入 `/doctor`
- `src/cli/theme.ts`
  - `/help` 命令表加入 `/doctor`
- `tests/repl-completer.test.ts`
  - 增加 `/doc` → `/doctor` 补全测试
- `scripts/repl-first-run-smoke.mjs`
  - 增加 `/doctor` 交互验收

## 验收标准

- `/doctor` 不触发 AI chat
- `/doctor` 不需要真实 API Key
- 缺 Key 时提示粘贴 API Key 或 `/apikey`
- REPL smoke 确认 `/doctor` 可输出 readiness guide
- 不泄露 API Key

## 已运行验证

- `npm run build` ✓
- `npm run test` ✓（14 files / 141 tests）
- `npm run smoke:repl` ✓（15/15）
