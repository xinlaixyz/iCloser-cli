# S1 Doctor Strict Gate

日期：2026-05-12
负责人：dev2
阶段：S1.26

## 目标

把 `ic doctor` 从诊断展示升级为可脚本消费的严格门禁。普通模式继续友好展示问题；严格模式在项目未 ready 时返回非 0，便于 CI、安装脚本或后续 UI shell 阻断执行。

## 本次变更

- `src/index.ts`
  - `ic doctor` 新增 `--strict`。
  - `ic doctor --strict --json` 仍输出统一 JSON envelope。
  - 当 `report.ready = false` 时设置 `process.exitCode = 1`。
  - 非 strict 模式保持原行为，未 ready 也返回 0，适合人工查看。
- `tests/json-contract-spawn.test.ts`
  - 新增未初始化目录下 `ic doctor --strict --json` 测试。
  - 验证退出码为 1。
  - 验证 stdout 仍是可解析 JSON。
- `README.md`
  - 补充 `ic doctor --strict` / `ic doctor --strict --json`。
- `doc/help.md`
  - 补充 strict 模式说明。
- `doc/DEVELOPMENT.md`
  - S1.24 Project Doctor 小节补充 strict gate 行为。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：11 个测试文件，79 个测试。
- `npm run smoke` 通过。
- `ic doctor --strict --json` 在未初始化目录返回 exit 1，stdout 仍可解析为 `kind: doctor`。

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.26 Doctor Strict Gate，请验收并补文档：

1. 新增命令能力：
   - ic doctor --strict
   - ic doctor --strict --json

2. 行为：
   - 普通 ic doctor / ic doctor --json 仍然只做诊断，未 ready 也返回 0。
   - strict 模式下，如果 data.ready = false，则退出码为 1。
   - strict + json 模式 stdout 仍必须是纯 JSON envelope，kind = doctor。

3. 已补测试：
   - tests/json-contract-spawn.test.ts
   - 未初始化临时目录运行 ic doctor --strict --json
   - 断言 status = 1，stdout 可 JSON.parse，nextActions 包含 ic init

4. 已验收：
   - npm run build 通过
   - npm run test：11 个测试文件，79 个测试
   - npm run smoke 通过

请你重点检查：
- README 中是否应该把 ic doctor --strict 标为 CI/脚本用法。
- DEVELOPMENT.md 是否应建议 CI 中可选增加 ic doctor --strict --json。
- help.md 的中文说明是否够清楚。
```

## 后续建议

- 如果 CI 希望在 smoke 前先做仓库自身 readiness，可加入 `ic doctor --strict --json`。
- 后续可扩展 `--require-real-provider`，用于生产环境禁止 mock provider。
