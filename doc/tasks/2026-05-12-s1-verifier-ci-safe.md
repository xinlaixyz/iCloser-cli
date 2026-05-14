# S1 Verifier CI-Safe Scripts

日期：2026-05-12
负责人：dev2
阶段：S1.8

## 目标

在优先尊重 `package.json` scripts 的基础上，避免常见测试脚本进入 watch、UI 或交互模式，让自动任务链可在 CLI/CI 环境中稳定结束。

## 本次变更

- `src/core/verifier.ts`
  - 新增 `resolveVerificationCommand()`，便于测试和后续 CLI 展示验证命令。
  - 对常见脚本做 CI-safe 归一化：
    - `vitest` 默认追加 `--run`，避免 watch。
    - `jest` 默认追加 `--runInBand`，减少并发进程干扰。
    - `cypress open` 归一化为 `npx --no-install cypress run`。
    - `playwright open/ui/codegen` 归一化为 `npx --no-install playwright test`。
  - 普通项目 scripts 仍按 `npm/pnpm/yarn run` 执行。
- `tests/verifier.test.ts`
  - 覆盖 `vitest --coverage` 自动追加 `--run`。
  - 覆盖 `cypress open` 回退到非交互 `cypress run`。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：7 个测试文件，22 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-ci-e2e-bcc1758d97fa411084c6fa04fd8a8a20`
  - 任务：`task-mp2gybzr-1vvdb`
  - 状态：`completed`
  - 测试统计：`4/4`
  - `verify.log` 确认使用项目脚本：`npm run build`、`npm run lint`、`npm run test`
  - `ic gate <task-id> --json` 返回 `passed: true`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.8 verifier CI-safe scripts：

1. src/core/verifier.ts 现在暴露 resolveVerificationCommand(rootPath, identity, stage)，后续 CLI/status 可以直接展示实际会跑的验证命令。
2. package.json scripts 仍优先，但会做非交互归一化：
   - vitest -> 追加 --run
   - jest -> 追加 --runInBand
   - cypress open -> npx --no-install cypress run
   - playwright open/ui/codegen -> npx --no-install playwright test
3. 当前 build/test 通过：7 个测试文件，22 个测试。
4. mock E2E 通过，任务 completed，gate passed。

你如果继续做 CLI 展示或任务执行链，请优先复用 resolveVerificationCommand，不要再自己拼验证命令。
```

## 后续建议

- 可以把 `resolveVerificationCommand()` 接入 `ic status` / `/status`，让用户预览真实验证命令。
- 下一步可做 `verify.log` 可读性增强：记录命令、退出码、stdout/stderr 摘要。
