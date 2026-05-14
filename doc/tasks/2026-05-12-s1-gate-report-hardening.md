# S1 Gate/Report Hardening

日期：2026-05-12
负责人：dev2
阶段：S1.6

## 目标

把任务完成后的交付门禁从“字段存在”推进到“真实交付物存在且未验证不可通过”，保证 mock/offline 主链能用于后续快速验收。

## 本次变更

- `src/gate/checker.ts`
  - 将 `pending` 门禁纳入 blocking，未执行验证时 gate 不再误判通过。
  - 报告门禁改为检查 `.icloser/tasks/<task-id>/report.md`、`reasoning.md`、`verify.log` 是否真实落盘。
- `src/index.ts`
  - 执行任务生成报告时同时生成 `verify.log`。
- `src/core/verifier.ts`
  - TypeScript/JavaScript 验证命令使用 `npx --no-install`，缺少本地依赖时快速失败，避免自动执行链等待下载或长时间卡住。
- `tests/report-gate.test.ts`
  - 覆盖“未验证不能过门禁”。
  - 覆盖“缺少报告交付物不能过门禁，生成报告/推理/验证日志后通过”。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：6 个测试文件，18 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-gate-e2e-efc16702964a4398982a9a80d129e127`
  - 任务：`task-mp2gdwt6-7z63n`
  - 生成交付物：`commit-message.txt`、`reasoning.md`、`report.md`、`task.json`、`verify.log`
  - `ic gate <task-id> --json` 返回 `passed: true`

## 后续建议

- `runVerification` 现在仍按语言固定推断命令，下一阶段可以优先读取 `package.json` scripts，再回退到内置命令。
- gate 目前对非 Git 仓库是 warn，不阻塞；进入团队分支流后可按项目配置决定是否必须 Git clean。
