# S1 Security Rule Registry

日期：2026-05-12
负责人：dev2
阶段：S1.16

## 目标

把安全规则的 `ruleId`、分类、严重级别、名称、说明和默认启用状态集中到一个注册表里，避免 scanner、report、CLI 各自维护硬编码规则清单。

## 本次变更

- `src/types.ts`
  - 新增 `SecurityRuleDefinition`，描述规则元数据。
- `src/core/security.ts`
  - 新增 `SECURITY_RULE_DEFINITIONS`。
  - 新增 `getSecurityRuleDefinitions()`。
  - 新增 `getSecurityRuleDefinition(ruleId)`。
  - 扫描逻辑改为从注册表读取 `category`、`severity`、`ruleId`。
- `src/index.ts`
  - `ic config security rules` 改为读取安全规则注册表。
  - `ic config security disable <ruleId>` / `enable <ruleId>` 改为真实可解析的三段参数。
  - 禁用/启用前会校验 `ruleId` 是否存在。
- `tests/security.test.ts`
  - 覆盖注册表完整性、唯一性、默认启用状态。
  - 校验扫描 issue 的 severity 来自注册表。

## 当前内置规则

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

## 验收

- `npm run build` 通过。
- `npm run test` 通过：9 个测试文件，44 个测试。
- CLI 轻量验收通过：
  - 临时项目：`C:\tmp\icloser-s1-16`
  - `node dist\index.js init --force`
  - `node dist\index.js config security disable secret-openai-key`
  - `node dist\index.js config security enable secret-openai-key`
  - `node dist\index.js config security rules`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.16 security rule registry，请基于这个结果继续做 CLI/体验层，不要再维护第二份硬编码规则清单：

1. 新增类型：
   - SecurityRuleDefinition
   - 字段：ruleId/category/severity/name/description/enabledByDefault

2. 安全规则注册表在 src/core/security.ts：
   - getSecurityRuleDefinitions()
   - getSecurityRuleDefinition(ruleId)

3. 当前内置 13 条 ruleId：
   - secret-openai-key
   - secret-aws-access-key
   - secret-private-key
   - secret-hardcoded-credential
   - danger-rm-rf-root
   - danger-git-push-force
   - danger-chmod-777
   - danger-drop-database-object
   - sql-string-concat
   - sql-template-interpolation
   - sql-query-concat
   - sensitive-file-modified
   - path-traversal-change

4. ic config security rules 已接入 registry。
5. ic config security disable <ruleId> / enable <ruleId> 已改成真实三段参数解析，并会校验未知 ruleId。
6. build/test 已通过：
   - npm run build
   - npm run test：9 个测试文件，44 个测试
7. CLI 轻量验收通过：
   - init --force
   - config security disable secret-openai-key
   - config security enable secret-openai-key
   - config security rules

你下一步如果继续做 CLI，请重点补：
- 给 config security rules 增加 --json 输出，便于脚本消费。
- 给 config security disable/enable 增加测试覆盖。
- 确认 help 文档和 doc/DEVELOPMENT.md 中的 config security 用法同步更新。
```

## 后续建议

- `ic config security rules --json`
- `ic config security status`
- 安全规则按 `category` 分组输出。
- 允许配置按 category 禁用，但默认仍建议只按 ruleId 禁用，避免过宽放行。
