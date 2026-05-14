# DEV2-S5.9 REPL Session Project Isolation

日期：2026-05-13

## 背景

用户在 `D:\temp\iCloser_dev` 启动 `ic`，欢迎页却显示旧项目 `iCloser2026`、旧框架 `react`。这会让用户误以为 Agent 正在操作另一个项目，是 P0 级体验问题。

## 根因

`loadSession()` 从全局 `~/.icloser/session.json` 读取并恢复：

- `projectName`
- `language`
- `framework`
- `conversation`
- `lastWrittenFiles`

其中项目字段会覆盖 `detectProjectContext()` 对当前 `process.cwd()` 的识别结果。

## 修复

- `saveSession()` 写入 `projectRoot: process.cwd()`。
- `loadSession()` 只有在保存的 `projectRoot` 等于当前 `process.cwd()` 时才恢复。
- `loadSession()` 不再恢复项目名/语言/框架，项目上下文永远来自当前目录。
- 不同项目目录启动时，不显示“已恢复上次会话”。

## 回归测试

`scripts/repl-first-run-smoke.mjs` 在临时 HOME 中预写一个旧项目 session：

- `projectName = iCloser2026`
- `language = typescript`
- `framework = react`
- `projectRoot = stale-iCloser2026`

随后在当前临时项目启动 REPL，断言：

- 不显示“已恢复上次会话”
- 不显示旧项目名 `iCloser2026`
- 显示当前项目上下文

## 验收

- `npm run build` 通过
- `npm run smoke:repl` 通过，31 passed
- `npm run test` 通过，17 files / 167 tests

