# DEV2-S6.10 Auto Repair Planner

## 背景

S6.9 已经能在验证失败时回滚，但用户真正想要的是系统先帮他判断怎么修，而不是只给“失败/回滚”。

## 本次完成

- 新增 `src/core/autopilot-repair.ts`。
- 根据 `AutopilotVerifyReceipt` 生成中文修复计划。
- REPL 验证失败后显示：
  - 1 查看修复建议
  - 2 回滚本次写入
  - 3 保留变更，稍后修复
- 修复规划阶段不自动写文件，避免未经确认扩大修改范围。

## 验收

- `npm run build`
- `npm run test -- autopilot-repair autopilot-rollback`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`
