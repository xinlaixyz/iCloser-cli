# S1 JSON Contract

日期：2026-05-12
负责人：dev2
阶段：S1.17

## 目标

为 CLI 的脚本消费场景固定稳定 JSON 输出契约，避免 `--json` 直接暴露内部对象结构，也避免 JSON 输出混入进度文案导致 CI/parser 解析失败。

## 本次变更

- `src/cli/json.ts`
  - 新增 `JSON_CONTRACT_VERSION = 1`。
  - 新增统一 envelope：`{ version, kind, data }`。
  - 新增 serializer：
    - `serializeTask()`
    - `serializeTaskList()`
    - `serializeGateResult()`
    - `serializeSecurityRules()`
- `src/index.ts`
  - `ic st --json` 输出 `kind: task-list`。
  - `ic st <task-id> --json` 输出 `kind: task`。
  - `ic gate <task-id> --json` 输出 `kind: gate-result`。
  - `ic config security rules --json` 输出 `kind: security-rules`。
  - 修复 `gate --json` 前置 progress 文案，保证 stdout 是纯 JSON。
- `tests/json-contract.test.ts`
  - 覆盖 envelope、task、task-list、gate-result、security-rules 的稳定字段。
- `doc/help.md`
  - 补充 `ic st --json` 和 `ic st <id> --json`。
- `doc/DEVELOPMENT.md`
  - 补充 `src/cli/json.ts` 和 JSON 输出契约说明。

## 当前 JSON Envelope

```json
{
  "version": 1,
  "kind": "task-list",
  "data": {}
}
```

## 验收

- `npm run build` 通过。
- `npm run test` 通过：10 个测试文件，59 个测试。
- CLI 轻量验收通过：
  - 临时项目：`C:\tmp\icloser-s1-17`
  - `node dist\index.js status --json` 可被 `ConvertFrom-Json` 解析，`kind = task-list`
  - `node dist\index.js gate <task-id> --json` 可被 `ConvertFrom-Json` 解析，`kind = gate-result`
  - `node dist\index.js config security rules --json` 可被 `ConvertFrom-Json` 解析，`kind = security-rules`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.17 JSON Contract，请验收并基于这个契约做 CLI/文档补充：

1. 新增 src/cli/json.ts，所有脚本可消费的 JSON 输出统一为：
   {
     "version": 1,
     "kind": "...",
     "data": {}
   }

2. 当前已接入：
   - ic st --json              -> kind: task-list
   - ic st <task-id> --json    -> kind: task
   - ic gate <task-id> --json  -> kind: gate-result
   - ic config security rules --json -> kind: security-rules

3. gate --json 已修复为 stdout 纯 JSON，不再混入 progress 文案。

4. 新增 tests/json-contract.test.ts，固定 envelope 和核心字段。

5. 当前验收：
   - npm run build 通过
   - npm run test 通过：10 个测试文件，59 个测试
   - status/gate/security rules 的 --json 输出均可被 ConvertFrom-Json 解析

你下一步可以补：
- CLI 层面的集成测试，直接 spawn node dist/index.js 验证 stdout 可 parse。
- help.md / README 中统一说明 JSON envelope。
- 如果继续新增 --json，不要直接 JSON.stringify 内部对象，优先走 src/cli/json.ts 的 serializer。
```

## 后续建议

- 增加 `ic scan --json`。
- 增加 `ic config --json`。
- 增加 CLI spawn 测试，防止将来 progress 文案再次污染 JSON stdout。
