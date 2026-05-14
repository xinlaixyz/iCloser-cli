# S3.5 Full Acceptance Smoke Aggregator

日期：2026-05-13
负责人：dev2

## 背景

S3 阶段已经形成多条验收脚本：

- `npm run smoke:first-run`
- `npm run smoke:repl`
- `npm run smoke`
- `npm run smoke:project`

这些脚本覆盖不同路径，但阶段交接时容易漏跑。需要一个总入口把完整验收顺序固化下来。

## 变更

- 新增 `scripts/full-smoke.mjs`
- 新增 npm script：`npm run smoke:all`
- 更新 README 和 DEVELOPMENT 的验收说明

## smoke:all 执行顺序

1. `npm run build`
2. `npm run test`
3. `npm run smoke:first-run`
4. `npm run smoke:repl`
5. `npm run smoke`
6. `npm run smoke:project`

## 验收标准

- 任一步失败时立即退出并返回非 0 exit code
- 输出明确标记当前步骤和最终 PASS/FAIL
- 不需要真实 API Key
- 不改变各专项 smoke 的原有行为

## 已运行验证

- `npm run smoke:repl` ✓
- `npm run build` ✓
- `npm run test` ✓
- `npm run smoke:first-run` ✓
- `npm run smoke` ✓
- `npm run smoke:project` ✓
