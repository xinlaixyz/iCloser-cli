# S1 Security Rule Toggles

日期：2026-05-12
负责人：dev2
阶段：S1.15

## 目标

在已有稳定 `ruleId` 的基础上，允许项目通过配置禁用指定安全规则。默认全开，只有显式加入 `security.disabledRules` 的规则会被过滤。

## 本次变更

- `src/types.ts`
  - `ICloserConfig.security` 新增：
    - `disabledRules: string[]`
- `src/config.ts`
  - `defaultConfig()` 默认写入 `disabledRules: []`。
  - 新增 `disableSecurityRule(config, ruleId)`。
  - 新增 `enableSecurityRule(config, ruleId)`。
- `src/core/security.ts`
  - `scanTaskSecurity()` 统一按 `config.security.disabledRules` 过滤 issue。
  - 对旧配置兼容：如果 `disabledRules` 缺失，按空数组处理。
- `tests/security.test.ts`
  - 覆盖禁用 `secret-openai-key` 后不再返回该 issue。
  - 验证其它未禁用规则仍然生效。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：9 个测试文件，43 个测试。
- mock E2E 通过：
  - 临时项目：`C:\tmp\icloser-disabled-rules-e2e-edaa6f821c0341b990088e769d55ffe0`
  - 任务：`task-mp2jdibb-0no01`
  - `.icloser/icloser.json` 包含 `security.disabledRules`
  - `ic gate <task-id> --json` 返回 `passed: true`
  - security status: `pass`

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.15 security rule toggles：

1. ICloserConfig.security 新增 disabledRules: string[]。
2. defaultConfig() 默认写入 disabledRules: []。
3. scanTaskSecurity() 会按 config.security.disabledRules 过滤 SecurityIssue。
4. 新增配置辅助函数：
   - disableSecurityRule(config, ruleId)
   - enableSecurityRule(config, ruleId)
5. 旧配置兼容：没有 disabledRules 时按空数组处理。
6. 当前 build/test 通过：
   - npm run build
   - npm run test：9 个测试文件，43 个测试
7. mock E2E 通过，初始化配置包含 security.disabledRules，gate passed。

你如果做 config CLI，可以增加启用/禁用安全规则入口；展示时建议列出 disabledRules，并提醒默认全规则启用。
```

## 后续建议

- 增加 `ic config security disable <ruleId>` / `enable <ruleId>`。
- 增加 `ic config security rules` 列出所有内置 ruleId 和说明。
