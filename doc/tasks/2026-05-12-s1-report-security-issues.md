# S1 Report Structured Security Issues

日期：2026-05-12
负责人：dev2
阶段：S1.14

## 目标

让 `report.md` 的“门禁检查”部分优先展示结构化 security issues，并确保 `ic gate <task-id>` 后报告会刷新到最新 gate 结果。

## 本次变更

- `src/report/generator.ts`
  - 安全阻塞项优先读取 `getSecurityIssuesFromGateCheck()`。
  - 报告中按列表展示：
    - `file:line`
    - `ruleId/severity`
    - message
    - 脱敏 evidence
  - 没有 structured issues 时继续 fallback 到 `suggestion` 文本，保持兼容。
- `src/index.ts`
  - `ic gate <task-id>` 执行完并持久化 `task.gateResult` 后，会重新生成 `report.md`。
  - 这样报告交付物会包含最新门禁结果。
- `tests/report-gate.test.ts`
  - 覆盖 report 中 security issue 的结构化展示和 secret 脱敏。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：9 个测试文件，42 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-report-security-e2e-fe6c0ae3f7a44debabafb984d49eb08d`
  - 任务：`task-mp2j5tlm-dey4j`
  - `ic gate <task-id> --json` 返回 `passed: true`
  - `report.md` 存在
  - `report.md` 包含“门禁检查”
  - `report.md` 包含 gate 通过结果

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.14 report structured security issues：

1. report.md 的门禁检查现在会优先展示 structured security issues。
2. security issue 在报告中展示为：
   file:line [ruleId/severity] message — evidence
3. secret evidence 仍然是脱敏后的内容，例如 sk-***。
4. ic gate <task-id> 执行后会重新生成 report.md，使报告包含最新 gateResult。
5. suggestion fallback 仍保留，老数据不受影响。
6. 当前 build/test 通过：
   - npm run build
   - npm run test：9 个测试文件，42 个测试
7. mock E2E 通过，gate passed，report.md 包含门禁检查。

你如果做报告展示/打开报告入口，可以假设 ic gate 后 report.md 是最新的；如果只读 task.gateResult，也可以使用 structuredIssues。
```

## 后续建议

- 可以为 `ic report` 增加 `--regenerate` 参数，手动刷新最新 task/report。
- 可以把 report 的 gate section 抽成纯 formatter，便于更多单元测试。
