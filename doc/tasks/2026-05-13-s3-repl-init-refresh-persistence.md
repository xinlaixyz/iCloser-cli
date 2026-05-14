# S3.10 REPL Init Refresh Persistence

日期：2026-05-13
负责人：dev2

## 背景

REPL 的 `/init` 原先主要刷新内存中的 `state.context` 和 `state.projectIndex`。这会造成一个新手体验断点：用户在 REPL 里执行 `/init` 后，后续 `/doctor` 仍可能因为项目配置未落盘而判断“未初始化”。

## 变更

- `src/cli/repl.ts`
  - `/init` 现在会写入 `.icloser/icloser.json`
  - `/init` 会调用 scanner 并写入 `.icloser/index.json`
  - `/scan` 会刷新项目识别、保存配置、保存索引，并同步 REPL 内存状态
  - 新增 `applyProjectIdentity()` 和 `summarizeProjectIndex()`，减少状态刷新遗漏
- `scripts/repl-init-refresh-smoke.mjs`
  - 从未初始化项目启动 REPL
  - 验证 `/doctor` 提示 `/init`
  - 验证 `/init` 后配置和索引落盘
  - 验证 `/doctor` 立刻看到已初始化和已生成索引
  - 验证 `/scan` 保持索引持久化
- `package.json`
  - 新增 `npm run smoke:repl:init`
- `scripts/full-smoke.mjs`
  - `smoke:all` 纳入 `smoke:repl:init`

## 验收标准

- `/init` 后 `.icloser/icloser.json` 存在
- `/init` 后 `.icloser/index.json` 存在
- `/doctor` 在同一 REPL 会话内看到已初始化
- `/scan` 后索引仍存在
- 不依赖真实 API Key

## 已运行验证

- `npm run build` ✓
- `npm run test` ✓（14 files / 141 tests）
- `npm run smoke:repl:init` ✓（10/10）
