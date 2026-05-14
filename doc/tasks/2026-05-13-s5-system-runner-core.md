# DEV2-S5.10 System Runner Core

日期：2026-05-13
开发者：dev2

## 背景

REPL 已经具备“启动项目”审批面板，但实际命令执行、后台服务管理、URL 捕获和退出清理仍混在 `src/cli/repl.ts`。这会让后续扩展“运行测试、安装依赖、打开项目、权限确认”等系统操作时继续膨胀交互层。

## 本次目标

把系统命令运行能力沉淀为 `system-runner` 核心模块，REPL 只负责用户输入、确认和展示。

## 完成内容

- 新增 `src/cli/system-runner.ts`
  - 前台命令：`runForegroundCommand()`。
  - 后台命令：`startBackgroundCommand()`。
  - 后台进程清理：`stopStartedProcess()`。
  - 本地 URL 捕获：`extractLocalUrl()`。
  - 命令输出整理：`formatCommandChunk()`。
- 更新 `src/cli/repl.ts`
  - 使用 `RunnerUi` 适配中文终端展示。
  - 复用 `system-runner` 执行 system operation steps。
- 新增 `tests/system-runner.test.ts`
  - 覆盖 URL 捕获、输出格式化、进程运行态判断。

## 验收命令

- `npm run build`
- `npm run test -- system-runner`
- `npm run smoke:repl`
- `npm run test`
- `npm run smoke:all`

## 后续建议

下一步可以继续把“文件写入确认”“系统命令确认”“任务行动确认”统一成一个 Choice Panel 协议，让用户始终只需要看中文选项、输入数字、回车确认。
