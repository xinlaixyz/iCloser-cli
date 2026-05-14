# DEV2-S5.5 PowerShell-style System Approval

日期：2026-05-13

## 背景

用户指出 S5.3 做成了 iCloser 紫色“下一步”选择框，但真正目标是类似 PowerShell/Claude Code 的命令审批面板。系统应该把命令、原因、影响和授权选择摆出来，用户只按数字确认。

## 本轮目标

- 不让新手输入命令。
- 系统自动识别命令并说明为什么执行。
- 以审批面板呈现系统权限操作。
- 支持一次授权、同类授权、拒绝。

## 修改内容

- `src/cli/repl.ts`
  - `PendingSystemOperation` 增加 `approvalKey`。
  - 新增会话级 `approvedSystemOperations`。
  - 系统操作确认从 iCloser 菜单改为：
    - `PowerShell command`
    - command
    - `This command requires approval`
    - 目录 / 原因 / 影响
    - `Do you want to proceed?`
    - `1. Yes`
    - `2. Yes, and don't ask again for: ...`
    - `3. No`
- `scripts/repl-first-run-smoke.mjs`
  - 更新 smoke 断言，要求出现 PowerShell/Shell approval 文案。
- `doc/iCloser_Agent_Shell_完整需求文档.md`
  - 修正系统权限操作标准样例。
- `doc/DEVELOPMENT.md`
  - 增加 DEV2-S5.5 开发记录。

## 验收标准

- `npm run build` 通过。
- `npm run smoke:repl` 通过。
- `npm run test` 通过。
- `npm run smoke:all` 通过。

