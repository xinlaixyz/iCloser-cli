# Changelog

## 2026-05-15 — Round 2: Deep Capability Upgrade (dev3)

### P6-P10: Multi-language scanning & rich context

1. **P6: Multi-language scanning** — `scanner.ts`: `getSourceFilePatterns` now scans ALL languages (Go+JS+TS+Python+CSS+Vue+etc), not just detected primary. Fixed `ui/` completely invisible bug.
2. **P7: AI chat for analysis** — `autopilot-router.ts`: "分析项目" now routes to AI chat with tool-calling loop (iterative file reading, code search, synthesis) instead of static autopilot.
3. **P8: Finer modules** — Scanning all file types naturally produces more modules (ui/, scripts/ now discovered).
4. **P9: Tech stack extraction** — `context.ts`: `extractTechStackDetails` reads go.mod, package.json, requirements.txt dependency lists into AI context.
5. **P10: Vendor stats** — `context.ts`: `countVendorDeps` counts vendor/node_modules without scanning their contents.

### Target project improvement (iCloserTV)

| Metric | Before | After |
|--------|--------|-------|
| Language | unknown | **go 1.18** |
| Framework | — | **react** |
| Database | — | **redis** |
| Test | — | **go-test** |
| Files | 306 (wrong) | **454** |
| Modules | 3 | **5** (now includes ui/, scripts/) |
| AI context | empty shell | README + deps + ext stats + dir overview + key file samples |

## 2026-05-15 — UX Sprint (dev3)

### UX 优化 (13 items)

1. **`fail()` 退出进程** — `output.ts`: 错误打印后 `process.exit(1)`，消除所有冗余 `return`
2. **`printHelp` 重构** — 旧名 `iCloser` → `ic`，补全 20+ 命令分组
3. **AI 执行进度反馈** — `index.ts`: 工具轮次显示 `(第 2/5 轮)`，完成摘要
4. **命令长别名** — `t→task`, `st→status`, `d→diff`, `y→accept`, `n→reject`, `g→gate`, `l→log`, `r→report`, `mem→memory`, `autopilot→auto`
5. **CLI orchestrate** — 已存在 `ic agent orchestrate`
6. **`--json` 补齐** — `ic init`, `ic scan`, `ic r` 全部支持 `--json`
7. **`ic mem` 帮助** — `ic mem` / `ic mem help` 显示子命令一览
8. **任务恢复** — `ic t --retry <task-id>` 重试失败任务
9. **scan 进度条** — 已有 ora spinner
10. **友好提示** — `ic r` 引导用户创建任务
11. **REPL 历史** — `/history` 命令显示最近 20 条对话
12. **搜索分离** — `ic web` 独立网络搜索命令，`ic search` 别名 `find`
13. **错误用户化** — AI 错误已有完善的中文分类+建议

### 能力提升 (5 items)

1. **P1: 递归项目检测** — `detect.ts`: `listAllFiles` 深度 5 递归，`readGoMod`/`readJsonFile` 子目录查找
2. **P2: 扩展名统计** — `context.ts`: `countFileExtensions` 注入 `.go:253 | .js:123` 分布
3. **P3: README 注入** — `context.ts`: `assembleProjectMeta` 自动读取 README 前 3000 字
4. **P4: 目录结构** — `context.ts`: `buildDirectoryOverview` 一级目录文件数统计
5. **P5: 入口文件采样** — `context.ts`: `scoreFiles` 关键文件自动提升到 0.9 分

### 指标

```
测试: 394 passed / 41 files / 0 failed
构建: tsc 零错误
Smoke: release ✅
```
