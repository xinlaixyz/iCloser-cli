# DEV2-S6.1 Project Autopilot Analyzer

日期：2026-05-13
开发者：dev2

## 背景

用户确认要做“大项目工程自动分析、自动撰写、自动生成代码、自动测试”等能力。该能力不能一开始就让 AI 大范围自动改项目，必须先建立只读分析、结构化计划、中文确认、自动验证的闭环。

## 完成内容

- 新增 `src/core/autopilot.ts`：Project Autopilot 只读分析核心。
- 新增 `ic autopilot` / `ic auto` 命令。
- 支持 `ic autopilot --json`。
- 新增 `tests/autopilot.test.ts`。
- 新增 `scripts/autopilot-smoke.mjs`。
- `smoke:all` 纳入 `smoke:autopilot`。
- 新增产品研发文档 `doc/PROJECT_AUTOPILOT.md`。

## 用户可用命令

```bash
ic autopilot
ic auto
ic autopilot --json
```

## 当前边界

S6.1 只分析，不写文件、不执行修复、不生成代码。后续 S6.2 才开始自动补齐 docs，且必须进入中文确认面板。

## 验收命令

- `npm run build`
- `npm run test -- autopilot`
- `npm run smoke:autopilot`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`
