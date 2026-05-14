# DEV2-S6.11 Controlled Auto Repair

## 背景

S6.10 已经能在验证失败后生成修复建议。S6.11 将高确定性、低风险场景推进到“自动修复一次 + 自动复验”。

## 本次完成

- 新增受控修复执行：`applyAutopilotRepairPlan()`。
- 文档空内容/缺一级标题可自动修复。
- 测试失败暂不自动改写，只保留诊断建议。
- REPL 失败面板支持：
  - 1 自动修复一次
  - 2 回滚本次写入
  - 3 保留变更，稍后修复
- 自动修复后自动复验，失败继续停留在中文选择面板。

## 验收

- `npm run build`
- `npm run test -- autopilot-repair autopilot-rollback`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`
