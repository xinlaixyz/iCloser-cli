# S1 Typed Security Metadata

日期：2026-05-12
负责人：dev2
阶段：S1.13

## 目标

把 `GateCheck.metadata.issues` 从 `unknown` 约定收窄为共享类型契约，让 CLI/status/report 层可以类型安全地消费安全问题。

## 本次变更

- `src/types.ts`
  - 新增共享类型 `SecurityIssue`。
  - 新增 `GateCheckMetadata`。
  - `GateCheck.metadata` 从 `Record<string, unknown>` 收窄为 `GateCheckMetadata`。
- `src/core/security.ts`
  - 移除本地 `SecurityIssue` 定义，改用共享类型。
  - 新增 `getSecurityIssuesFromGateCheck(check)`，统一从 gate metadata 提取安全问题。
- `src/cli/format.ts`
  - `security.structuredIssues` 从 `unknown[]` 改为 `SecurityIssue[]`。
  - 改为复用 `getSecurityIssuesFromGateCheck()`。
- `tests/security.test.ts`
  - 覆盖 typed metadata 提取。
- `tests/format-status.test.ts`
  - 覆盖 `structuredIssues` 中的强结构字段。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：9 个测试文件，42 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-typed-metadata-e2e-2805bf08587e4beba597b9530bef2806`
  - 任务：`task-mp2j09lj-k17s1`
  - `ic gate <task-id> --json`：
    - `passed: true`
    - security status: `pass`
    - `metadata.issues` 存在
    - `metadata.issues.length = 0`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.13 typed security metadata：

1. src/types.ts 新增共享类型 SecurityIssue 和 GateCheckMetadata。
2. GateCheck.metadata 现在类型为 GateCheckMetadata，不再只是 Record<string, unknown>。
3. src/core/security.ts 新增 getSecurityIssuesFromGateCheck(check)，用于类型安全读取 security issues。
4. formatGateSummary().security.structuredIssues 现在是 SecurityIssue[]。
5. suggestion 文本仍保留，现有按行展示逻辑不受影响。
6. 当前 build/test 通过：
   - npm run build
   - npm run test：9 个测试文件，42 个测试
7. mock E2E 通过，gate passed，security metadata issues 存在。

你如果做 status/security 展示，请优先用 formatGateSummary().security.structuredIssues 或 getSecurityIssuesFromGateCheck()，不要手写 metadata as any。
```

## 后续建议

- 可以让 report.md 的“门禁检查”部分优先展示 structured issues。
- 可以按 `SecurityIssue.ruleId` 做项目级规则开关。
