# S1 Security Gate Hardening

日期：2026-05-12
负责人：dev2
阶段：S1.10

## 目标

把安全门禁从“只看文件名和变更意图”推进到“扫描实际变更文件内容”，让 gate 能阻断明显的硬编码密钥、危险命令和 SQL 拼接风险。

## 本次变更

- `src/core/security.ts`
  - 新增 `SecurityIssue`。
  - 新增 `scanTaskSecurity(rootPath, task, config)`。
  - 支持扫描：
    - 敏感文件变更。
    - OpenAI/AWS/Private Key/硬编码 token/password/API key。
    - `rm -rf /`、`git push --force`、`chmod 777`、`DROP TABLE/DATABASE` 等危险命令文本。
    - 常见 SQL 字符串拼接风险。
  - 检查变更路径是否逃逸项目根目录。
- `src/gate/checker.ts`
  - 安全门禁改为调用 `scanTaskSecurity()`。
  - 发现安全问题时 gate blocking，并在 suggestion 中输出文件、原因和严重级别。
- `tests/security.test.ts`
  - 覆盖硬编码 secret 扫描。
  - 覆盖 SQL 字符串拼接扫描。
- `tests/report-gate.test.ts`
  - 覆盖 gate 因硬编码 secret 阻塞交付。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：8 个测试文件，26 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-security-e2e-5f33685cb0b94d1fa281e719b6da387d`
  - 任务：`task-mp2hgwf6-3seo7`
  - 状态：`completed`
  - `ic gate <task-id> --json` 返回 `passed: true`
  - 安全门禁为 `pass`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.10 security gate hardening：

1. src/core/security.ts 新增 scanTaskSecurity(rootPath, task, config) 和 SecurityIssue。
2. gate 的安全门禁现在会扫描实际变更文件内容，不再只依赖文件名/change.intent。
3. 当前会阻断：
   - 敏感文件变更
   - OpenAI/AWS/Private Key/硬编码 token/password/API key
   - rm -rf /、git push --force、chmod 777、DROP TABLE/DATABASE 等危险命令文本
   - 常见 SQL 字符串拼接风险
4. src/gate/checker.ts 已接入 scanTaskSecurity，发现问题会产生 security blocking。
5. 当前 build/test 通过：8 个测试文件，26 个测试。
6. mock E2E 通过，普通任务 gate passed，安全门禁 pass。

你如果做 CLI/status 展示，请把 gateResult 中 category=security 的 blocking/suggestion 展示出来即可，不要重新扫描文件。
```

## 后续建议

- 目前是轻量正则扫描，不替代专业 secret scanner。后续可接入 gitleaks/trufflehog 等外部工具。
- 后续可以为 security issue 增加 `line`、`ruleId` 字段，让 CLI 定位更精准。
