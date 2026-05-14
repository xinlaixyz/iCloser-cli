# S1 SecurityIssue Structured Metadata

日期：2026-05-12
负责人：dev2
阶段：S1.11

## 目标

把安全扫描结果从纯文本告警升级为可定位、可展示、可脱敏的结构化 issue，便于 CLI/status/报告层直接展示文件、行号、规则和证据摘要。

## 本次变更

- `src/core/security.ts`
  - `SecurityIssue` 新增：
    - `ruleId`
    - `line`
    - `evidence`
  - secret 证据会脱敏，例如 OpenAI key 输出为 `sk-***`。
  - 每类规则拥有稳定 `ruleId`：
    - `secret-openai-key`
    - `secret-aws-access-key`
    - `secret-private-key`
    - `secret-hardcoded-credential`
    - `danger-rm-rf-root`
    - `danger-git-push-force`
    - `danger-chmod-777`
    - `danger-drop-database-object`
    - `sql-string-concat`
    - `sql-template-interpolation`
    - `sql-query-concat`
    - `sensitive-file-modified`
    - `path-traversal-change`
- `src/gate/checker.ts`
  - security suggestion 改为一行一个 issue：
    - `file:line [ruleId/severity] message — evidence`
  - 这更适配 `formatGateSummary()` 和 CLI/status 按换行展示。
- `src/cli/format.ts`
  - 修复 formatter 对失败 stderr 摘要的处理：优先展示非 warning 行，避免 warning 抢占错误摘要。
- `tests/security.test.ts`
  - 覆盖 `ruleId`、`line`、`evidence`、secret 脱敏和路径逃逸。
- `tests/report-gate.test.ts`
  - 覆盖 gate security suggestion 的结构化格式与脱敏。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：9 个测试文件，41 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-security-structured-e2e-c7c45eed521e46cc9d898397caec83b4`
  - 任务：`task-mp2if8y0-zclms`
  - 状态：`completed`
  - `ic gate <task-id> --json` 返回 `passed: true`
  - 安全门禁为 `pass`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.11 SecurityIssue structured metadata：

1. SecurityIssue 新增 ruleId/line/evidence 字段。
2. scanTaskSecurity() 会返回稳定 ruleId，并对 secret evidence 脱敏，例如 sk-***。
3. gate 的 security suggestion 现在是一行一个 issue：
   file:line [ruleId/severity] message — evidence
4. formatGateSummary() 可继续按换行拆 securityCheck.suggestion，不需要重新扫描文件。
5. 当前 build/test 通过：9 个测试文件，41 个测试。
6. mock E2E 通过，普通任务 gate passed，安全门禁 pass。

如果你做 status/security 展示，建议直接展示 suggestion 行；后续如果要更强结构化，可以再把 GateCheck 扩展出 metadata，但当前不要破坏 GateCheck 兼容。
```

## 后续建议

- 下一步可以把 `SecurityIssue` 作为 `GateCheck` 的 metadata 持久化，而不是只编码进 suggestion 字符串。
- 可以新增规则开关，让项目按风险接受度启用/禁用某些 ruleId。
