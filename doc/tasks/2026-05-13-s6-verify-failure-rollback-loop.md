# DEV2-S6.9 Verify Failure Rollback Loop

## 背景

Autopilot 已经可以自动分析、写文档、写测试并验证。缺口是：验证失败后，系统不能只告诉用户失败，也不能要求新手手工判断文件该不该删。

## 本次完成

- 新增 `src/core/autopilot-rollback.ts`。
- 写入前创建文件快照。
- 验证失败后展示中文选择面板。
- 支持一键回滚本轮 autopilot 写入：
  - 写入前不存在：删除新建文件。
  - 写入前存在：恢复原始内容。
- 新增 `tests/autopilot-rollback.test.ts`。

## 用户路径

1. 用户输入：`帮我自动补单测`。
2. 系统展示写入确认。
3. 用户选择 1。
4. 系统写入测试并运行验证。
5. 如果验证失败，系统展示：
   - 1 回滚本次写入
   - 2 保留变更，稍后修复
   - 3 查看回滚方案

## 验收

- `npm run build`
- `npm run test -- autopilot-rollback`
- `npm run test`
- `npm run lint`
- `npm run smoke:all`
