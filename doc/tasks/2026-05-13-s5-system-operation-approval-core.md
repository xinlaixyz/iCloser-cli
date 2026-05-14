# DEV2-S5.8 System Operation Approval Core

日期：2026-05-13

## 背景

S5.5 已把“启动项目”改成 PowerShell/Claude Code 风格审批面板，但实现仍散落在 `src/cli/repl.ts`。为了完成 MVP 的系统操作底座，需要先抽出统一审批核心。

## 本轮目标

- 系统操作用统一数据结构描述。
- 审批面板统一渲染。
- npm/pnpm/yarn 命令生成统一处理 Windows/macOS/Linux 差异。
- REPL 只负责用户输入与执行编排。

## 修改内容

- 新增 `src/cli/system-approval.ts`
  - `SystemOperation`
  - `SystemOperationStep`
  - `createStartProjectOperation()`
  - `renderSystemOperationApproval()`
  - `detectPackageManager()`
  - `packageManagerCommand()`
- 更新 `src/cli/repl.ts`
  - 使用 `SystemOperation` 替代本地 `PendingSystemOperation`。
  - 使用 `renderSystemOperationApproval()` 输出审批面板。
  - 执行逻辑改为按 `operation.steps` 顺序执行。
- 新增 `tests/system-approval.test.ts`

## 验收结果

- `npm run build` 通过
- `npm run test -- system-approval` 通过，4 tests
- `npm run smoke:repl` 通过，31 passed

## 剩余工作

下一步可继续把 `runForegroundCommand()`、`startBackgroundDevServer()` 和进程停止逻辑抽成 `system-runner.ts`，但本轮先保持低风险。

