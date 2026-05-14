# S3.7 Beginner Doctor Next Actions

日期：2026-05-13
负责人：dev2

## 背景

`ic doctor` 已经能判断项目是否 ready，但 `nextActions` 偏工程师视角。对完全新手来说，最容易卡在三处：

- 不知道先初始化项目
- 不知道 API Key 可以直接粘贴到 REPL
- 不知道索引缺失时要重新扫描

## 变更

- `src/index.ts`
  - `buildDoctorReport()` 的 `nextActions` 增加新手路径：
    - 未初始化：`ic init` → `ic` → 粘贴 API Key 或 `/apikey`
    - Provider 缺 Key：`ic` → 粘贴 API Key 或 `/apikey` → `ic provider env <name>` → `ic provider test`
    - 缺索引：`ic scan`
    - 已 ready：`ic t "你的任务描述"`
- `tests/json-contract-spawn.test.ts`
  - 增加缺 Provider Key 的 doctor nextActions 回归
  - 增加缺 index 的 doctor nextActions 回归
- README / DEVELOPMENT 更新新手说明

## 验收标准

- JSON envelope 不变：`kind=doctor`，`data.nextActions` 仍为字符串数组
- `ic doctor --strict --json` 未初始化时仍返回非 0
- 新手路径包含 `ic`、API Key、`/apikey`
- 缺索引时包含 `ic scan`
- 不泄露任何 API Key

## 已运行验证

- `npm run build` ✓
- `npm run test` ✓（14 files / 140 tests）
