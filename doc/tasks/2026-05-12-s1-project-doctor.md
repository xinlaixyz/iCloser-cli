# S1 Project Doctor

日期：2026-05-12
负责人：dev2
阶段：S1.24

## 目标

新增顶层项目就绪诊断命令，让用户在执行任务前能一眼确认当前项目是否已经具备最小可运行条件。

## 本次变更

- `src/index.ts`
  - 新增 `ic doctor`
  - 新增 `ic doctor --json`
  - 汇总检查：
    - 当前项目是否已初始化
    - `.icloser/index.json` 是否存在
    - 当前 Provider / model / API Key 来源 / ready 状态
    - 当前任务数量
    - warnings
    - nextActions
- `tests/json-contract-spawn.test.ts`
  - 新增 `ic doctor --json` spawn 测试，确保 stdout 可解析、kind 为 `doctor`。
- `README.md`
  - Quick Start / Provider 管理 / JSON Output / Commands 增加 `ic doctor`。
- `doc/help.md`
  - 配置命令区和 JSON 输出契约增加 `ic doctor --json`。
- `doc/DEVELOPMENT.md`
  - S1.17 JSON kind 列表增加 `doctor`。
  - 新增 S1.24 Project Doctor 小节。
- `scripts/release-smoke.mjs`
  - 将 `ic doctor --json` 纳入主链 smoke。
- `package.json`
  - 新增 `npm run smoke:keep`，保留临时项目便于排查。

## 验收

- `npm run build` 通过。
- `npm run test` 通过：11 个测试文件，79 个测试。
- `npm run smoke` 通过。
- 手动检查：
  - 未初始化目录运行 `ic doctor --json` 可解析。
  - 初始化并切换 mock 后运行 `ic doctor` 显示 ready。

## 给 dev1 的同步提示词

```text
dev2 已完成 S1.24 Project Doctor，请验收并补齐你认为必要的文档/体验细节：

1. 新增顶层命令：
   - ic doctor
   - ic doctor --json

2. doctor 会检查：
   - 项目是否已 ic init
   - .icloser/index.json 是否存在
   - 当前 Provider、model、API Key 来源、ready 状态
   - 当前任务数量
   - warnings
   - nextActions

3. JSON 输出：
   - 使用统一 envelope
   - kind = doctor
   - stdout 必须是纯 JSON，不允许混入颜色码或进度文案

4. 已补测试：
   - tests/json-contract-spawn.test.ts 中覆盖 ic doctor --json 可解析

5. 已跑验收：
   - npm run build
   - npm run test：11 个测试文件，79 个测试
   - npm run smoke

请你重点检查：
- README 的 Quick Start 是否应该把 ic doctor 放在 ic init 后、ic t 前。
- doc/help.md 的命令说明是否需要调整中文措辞。
- DEVELOPMENT.md 的“本地可跑版验收”流程是否清楚。
- npm run smoke:keep 的描述是否足够清楚。
- 如果你继续做 CI 文档，可以把 ic doctor --json 放进 smoke 之外的可选诊断命令。
```

## 后续建议

- 将 `ic doctor --json` 接入未来 UI shell 的启动前诊断。
- S1.26 已增加 `--strict`，未 ready 时返回非 0，便于 CI/脚本门禁使用。
