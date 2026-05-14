# S1 Gate Metadata for Security Issues

日期：2026-05-12
负责人：dev2
阶段：S1.12

## 目标

把安全扫描结构化结果持久化到 `GateCheck.metadata`，保留现有 `suggestion` 文本兼容，让 CLI/status/report 可以逐步从字符串解析迁移到结构化字段。

## 本次变更

- `src/types.ts`
  - `GateCheck` 新增可选字段：
    - `metadata?: Record<string, unknown>`
- `src/gate/checker.ts`
  - security gate 失败时：
    - `suggestion` 继续输出一行一个 issue，保持旧展示兼容。
    - `metadata.issues` 写入完整 `SecurityIssue[]`。
  - security gate 通过时：
    - `metadata.issues = []`。
- `src/cli/format.ts`
  - `formatGateSummary()` 新增 `security.structuredIssues`。
  - 仍保留 `security.issues` 从 suggestion 拆行，兼容现有 CLI 展示。
- `src/cli/repl.ts`
  - 修复 dev1 改动后文件被截断导致的 build 失败。
  - 补回最小 REPL helper 实现，恢复 `npm run build`。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：9 个测试文件，41 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-gate-metadata-e2e-bbff2ee9a1a347c182d26fdbb5cc24c3`
  - 任务：`task-mp2ivcyz-t2zxs`
  - `ic gate <task-id> --json`：
    - `passed: true`
    - security status: `pass`
    - security metadata 存在
    - `metadata.issues.length = 0`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.12 GateCheck metadata for security issues：

1. GateCheck 新增可选字段 metadata?: Record<string, unknown>。
2. security gate 现在会写 metadata.issues：
   - fail 时是完整 SecurityIssue[]
   - pass 时是 []
3. suggestion 文本仍保留，格式仍是一行一个 issue，现有 CLI 展示不会断。
4. formatGateSummary() 新增 security.structuredIssues，同时保留 security.issues。
5. dev2 修复了 src/cli/repl.ts 被截断导致的 build 失败，当前 build/test 通过：
   - npm run build
   - npm run test：9 个测试文件，41 个测试
6. mock E2E 通过，gate passed，security metadata 存在。

你如果继续做 status/security 展示，优先读 security.structuredIssues；如果不存在，再回退到 suggestion/分行文本。
```

## 后续建议

- 可以给 `GateCheck.metadata` 做类型收窄，例如按 category 定义 discriminated union。
- status/report 层可以逐步从 `suggestion` 文本迁移到 `metadata.issues`。
