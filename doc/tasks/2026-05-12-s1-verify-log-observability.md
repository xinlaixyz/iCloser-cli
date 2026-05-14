# S1 Verify Log Observability

日期：2026-05-12
负责人：dev2
阶段：S1.9

## 目标

增强 `verify.log` 的排障价值：验证失败或通过时都能看到实际执行命令、退出码和关键 stdout/stderr，避免只看到“编译失败/测试失败”这种低信息量结果。

## 本次变更

- `src/types.ts`
  - `StageResult` 新增可选字段：
    - `command`
    - `exitCode`
    - `stdout`
    - `stderr`
- `src/core/verifier.ts`
  - 每个执行型 stage 记录实际命令。
  - 成功时记录 `exitCode: 0` 和 stdout。
  - 失败时记录退出码、stdout、stderr，并生成结构化 `errorDetails`。
- `src/report/generator.ts`
  - `generateVerifyLog()` 输出命令、退出码、stdout/stderr/error details。
  - 单段日志最长保留 8000 字符，超出后截断，避免日志无限膨胀。
- `tests/verifier.test.ts`
  - 断言失败脚本会保留 `command`、`exitCode`、`stderr`。
- `tests/report-gate.test.ts`
  - 断言 `verify.log` 会写出命令、退出码、stdout、stderr。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：7 个测试文件，23 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-verifylog-e2e-411d57641aee499398699534cd1af85c`
  - 任务：`task-mp2h6mc2-i7jnm`
  - 状态：`completed`
  - 测试统计：`5/5`
  - `verify.log` 包含：
    - `命令: npm run -s build`
    - `退出码: 0`
    - stdout 内容 `build ok verifylog`
  - `ic gate <task-id> --json` 返回 `passed: true`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.9 verify.log observability：

1. StageResult 新增可选字段 command/exitCode/stdout/stderr。
2. verifier 每个执行型 stage 会记录实际命令、退出码和 stdout/stderr。
3. generateVerifyLog() 会把这些信息写入 .icloser/tasks/<task-id>/verify.log，并对长日志做 8000 字符截断。
4. 当前 build/test 通过：7 个测试文件，23 个测试。
5. mock E2E 通过，任务 completed，gate passed。

你如果要展示验证结果，请优先读取 StageResult.command/exitCode/stdout/stderr 或 verify.log，不要再只展示 output/errorDetails。
```

## 后续建议

- 可以把 `verify.log` 中的命令摘要同步展示到 `ic status <task-id>`。
- 后续若接入真实 AI 修复循环，失败 stage 的 `stdout/stderr/errorDetails` 可以直接作为修复上下文输入。
