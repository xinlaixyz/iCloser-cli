# DEV2-S6.8 Natural Language Autopilot Router

## 背景

用户不应该记住 `ic autopilot docs --go` 这类命令。REPL 必须理解普通中文需求，并在本地直接执行可审计的工程链路。

## 本次完成

- 新增自然语言路由器 `src/core/autopilot-router.ts`。
- REPL 在大模型调用前拦截高置信本地工程意图。
- 读操作直接执行：项目分析、测试缺口分析、自动执行链展示。
- 写操作先展示中文选择面板，用户只需输入数字确认。
- 写入后输出真实路径、磁盘确认、自动校验结果。
- 新增路由单测 `tests/autopilot-router.test.ts`。

## 用户路径

1. 用户输入：`分析整个项目`。
2. 系统直接扫描当前目录并输出工程分析。
3. 用户输入：`补齐文档`。
4. 系统展示待写入文档列表和 1/2/3 选择面板。
5. 用户输入 `1`。
6. 系统写入 `docs/*.md`，显示完整路径，并自动校验。

## 验收

- `npm run build`
- `npm run test -- autopilot-router`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`
