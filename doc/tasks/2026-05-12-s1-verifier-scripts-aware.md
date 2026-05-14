# S1 Verifier Scripts-Aware

日期：2026-05-12
负责人：dev2
阶段：S1.7

## 目标

让验证流水线优先尊重项目自己的 `package.json` scripts，减少按语言硬猜命令带来的误判、卡住和不符合项目约定的问题。

## 本次变更

- `src/core/verifier.ts`
  - TypeScript/JavaScript 项目优先读取 `package.json` scripts。
  - stage 到 scripts 的映射：
    - `compile`：`typecheck`、`type-check`、`check-types`、`build`、`compile`
    - `lint`：`lint`、`eslint`
    - `unit-test`：`test:unit`、`unit-test`、`test`
    - `integration-test`：`test:integration`、`integration-test`、`test:it`
    - `e2e`：`test:e2e`、`e2e`、`test:e2e:ci`
  - 自动选择 runner：`pnpm-lock.yaml` → `pnpm`，`yarn.lock` → `yarn`，否则 `npm`；也支持 `packageManager` / detect identity 中的 packageManager。
  - 找不到项目脚本时回退到语言内置命令。
- `tests/verifier.test.ts`
  - 覆盖 compile/unit-test 优先使用 package scripts。
  - 覆盖失败脚本会快速失败，并跳过后续 stage。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：7 个测试文件，20 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-verifier-e2e-938371422f9d46c6896b032aef1b4d1b`
  - 任务：`task-mp2gqp1s-v1913`
  - 状态：`completed`
  - 测试统计：`3/3`
  - `verify.log` 确认使用项目脚本：`npm run build`、`npm run lint`、`npm run test`

## 后续建议

- 当前 scripts 执行仍依赖项目自己的命令是否为 CI 模式。后续可以识别 `vitest`、`playwright` 等常见 watch 命令，并自动追加 CI 参数。
- 可以把验证命令解析结果展示到 `ic status` 或 `/status`，方便用户知道将要跑哪些 gate。
