# S1.16: CLI config/security/status/report 整体整合收口

**日期：** 2026-05-12
**执行者：** S1
**状态：** ✅ 完成

## 改动文件

### `src/index.ts`
- 新增 `ic config security` — 安全配置摘要（禁用规则数/敏感文件/危险命令/Git Push状态）
- 新增 `ic config security rules` — 列出全部 13 条安全规则及启用/禁用状态
- 新增 `ic config security disable <ruleId>` — 禁用规则（调用 `disableSecurityRule`）
- 新增 `ic config security enable <ruleId>` — 启用规则（调用 `enableSecurityRule`）
- 新增 `printSecurityRules()` 函数 + `ALL_SECURITY_RULES` 常量
- 增强 `ic config` 主视图：新增"安全规则"行显示禁用数
- 增强 `ic st <task-id>` gate 章节：使用 `SecurityIssue[]` 结构化展示
- 新增 `ic r --regenerate` — 强制重新生成报告

### `tests/format-status.test.ts`
- 新增 `security rules config` 测试组（4 个测试）
- 新增 `formatGateSummary structured issues` 测试组（2 个测试）
- 覆盖：disable/enable/去重/空操作/structuredIssues 提取/fallback

### `doc/help.md`
- 配置表新增 3 行：`ic config security` / `security rules` / `disable|enable`
- 报告表新增：`ic r --regenerate`

### `doc/DEVELOPMENT.md`
- 新增 S1.16 安全配置集成章节（安全规则管理/扫描展示/报告重新生成）

## 验收结果

```
npm run build    ✅ 零错误
npm run test     ✅ 9 files, 50 tests

E2E (mock):
✅ ic config security rules        — 展示 13 条规则，全部启用
✅ ic config security disable      — 规则禁用
✅ ic config security              — 显示 1 条已禁用
✅ ic config security enable       — 规则重新启用
✅ ic t "..." --go                 — 任务执行
✅ ic gate <task-id>               — 门禁展示 4 个结构化安全阻塞
✅ ic st <task-id>                 — 验证阶段 + 安全阻塞详情
✅ ic r                            — 展示最新报告
✅ ic r --regenerate               — 重新生成报告
```

### E2E 安全阻塞输出示例
```
  ▸ HIGH src/config.ts:54             danger-rm-rf-root
     'rm -rf /', 'git push --force', 'DROP TABLE', ...
     疑似危险命令
  ▸ HIGH src/config.ts:55             danger-chmod-777
     'chmod 777', ':(){ :|:& };:', ...
     疑似危险命令
```

## 依赖 dev2 接口

- `disableSecurityRule(config, ruleId)` / `enableSecurityRule(config, ruleId)` → src/config.ts
- `SecurityIssue` / `GateCheckMetadata` → src/types.ts
- `getSecurityIssuesFromGateCheck(check)` → src/core/security.js
- `formatGateSummary().security.structuredIssues` → src/cli/format.ts
