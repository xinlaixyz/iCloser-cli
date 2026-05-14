# S3.3 REPL First-Run Interaction Smoke

日期：2026-05-13
负责人：dev1
状态：完成

## 目标

补全 first-run smoke 缺失的 REPL 交互验收。之前 first-run smoke 只覆盖 CLI JSON 输出，S3.3 增加真正的 REPL spawn + stdin/stdout 交互测试。

## 变更

### 新增文件

| 文件 | 说明 |
|------|------|
| `scripts/repl-first-run-smoke.mjs` | REPL 交互验收脚本（14 个断言） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 新增 `smoke:repl` 脚本 |
| `README.md` | smoke 区域补充 `npm run smoke:repl` |
| `doc/DEVELOPMENT.md` | 新增 S3.3 记录 |

## 验收流程

```
spawn REPL (临时 HOME, 无全局配置)
  → STEP 1: 验证 welcome screen + mock/key 引导
  → STEP 2: 输入"我要配置 key" → 不触发 AI, 输出 Key 引导
  → STEP 3: /apikey → 默认 deepseek → 输入 fake key
  → STEP 4: 验证输出无明文 fake key
  → STEP 5: /status → REPL 仍可工作
  → STEP 6: /exit → 正常退出 (exit=0)
  → STEP 7: stderr 无 key 泄露
  → STEP 8: 全局 config.json 持久化验证
```

## 14 个断言

| # | 断言 | 验证点 |
|---|------|--------|
| 1 | REPL started | 进程 spawn 后正常输出 |
| 2 | Mock/key guidance on startup | 无全局配置时显示 key 引导 |
| 3 | "我要配置 key" not AI chat | `isApiKeyHelpIntent` 拦截生效 |
| 4 | "我要配置 key" shows guidance | `printProviderKeyHelp` 输出 |
| 5 | /apikey provider prompt | 安全输入向导启动 |
| 6 | Fake key NOT in plaintext | 隐藏输入不泄露明文 |
| 7 | Key masked in confirmation | 脱敏展示或 keySource 显示 |
| 8 | /status works | REPL 保持可用 |
| 9 | /exit clean | exit code = 0 |
| 10 | Key NOT in stderr | 无意外泄露 |
| 11 | Global config.json created | 持久化成功 |
| 12 | provider=deepseek saved | 配置正确 |
| 13 | apiKey saved | Key 写入磁盘 |
| 14 | Saved key matches input | 磁盘 Key 与输入一致 |

## 实现要点

- REPL 内置 `loadGlobalConfig()` 从 `$HOME/.icloser/config.json` 读取，不跟随 `ICLOSER_HOME`。脚本通过覆盖 `HOME` + `USERPROFILE` 环境变量实现临时隔离。
- `/apikey` 使用 `rl.question` 进行隐藏输入（`mutedInput` 模式覆盖 `_writeToOutput`），spawn 的 pipe stdin 仍能正常交互。
- 输出中包含 ANSI 转义码（chalk colors），strip 后再做明文 key 检测。
- 不使用真实网络 — fake key 即可覆盖所有路径。

## 验收

| 检查项 | 结果 |
|--------|------|
| `npm run build` | 通过 |
| `npm run test` | 通过 |
| `npm run smoke:first-run` | 通过 |
| `npm run smoke:repl` | 14/14 通过 |
| `npm run smoke` | 通过 |
| `npm run smoke:project` | 通过 |
