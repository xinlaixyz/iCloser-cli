# S2.3 Real Project Smoke Harness

日期：2026-05-13
负责人：dev2
状态：完成

## 目标

把“真实项目形态验收”固化为可重复脚本。release smoke 只验证极简文本项目，S2.3 增加一个最小 TypeScript 项目，用于覆盖项目识别、索引、doctor strict、结构化输出、项目自身 build/lint/test、gate/report。

## 本次变更

- `scripts/real-project-smoke.mjs`
  - 新增真实项目形态 smoke。
  - 自动创建临时 TypeScript 项目。
  - 使用 mock provider，避免真实 API Key 影响稳定性。
  - 验证 `src/math.ts` 被任务链修改。
  - 验证项目自己的 build/lint/test 被 verifier 调用并通过。
- `package.json`
  - 新增 `npm run smoke:project`。
- `README.md`
  - 补充 `npm run smoke:project`。
- `doc/DEVELOPMENT.md`
  - 新增 S2.3 记录。

## 验收标准

- `npm run build` 通过。
- `npm run test` 通过。
- `npm run smoke` 通过。
- `npm run smoke:project` 通过。
- `smoke:project` 输出 `[project-smoke] PASS <task-id>`。
- `ic doctor --strict --json` 在临时 TypeScript 项目中 ready = true。
- `ic gate --json` passed = true。

## 当前验收

- `npm run build` 通过。
- `npm run test` 通过：12 个测试文件，101 个测试（S2.4/S2.5 后复验）。
- `npm run smoke:project` 通过。
- `npm run smoke` 通过。
- `smoke:project` 临时项目识别为 TypeScript。
- `smoke:project` 修改 `src/math.ts`，任务状态 completed。
- `ic gate --json` passed = true。

## 给 dev1 的提示词

```text
请开始 S2.3 Real Provider Live Acceptance。

背景：
dev2 已新增 npm run smoke:project，用 mock provider 在临时 TypeScript 项目中验证真实项目形态闭环。
你的任务是补真实 Provider live acceptance 文档和实测路径，不改 smoke 默认 mock 行为。

请做：
1. 阅读：
   - doc/S2_DEVELOPMENT_PLAN.md
   - doc/tasks/2026-05-13-s2-real-provider-task-chain.md
   - doc/tasks/2026-05-13-s2-ai-output-contract.md
   - doc/tasks/2026-05-13-s2-real-project-smoke-harness.md

2. 选择一个真实 Provider，优先 DeepSeek：
   - 配置 API Key
   - ic provider use deepseek
   - ic provider test

3. 在一个最小 TypeScript 项目中实测：
   - ic init --force
   - ic doctor --strict --json
   - ic t "修改 src/math.ts 添加一个简单函数" --go
   - ic gate <task-id> --json
   - ic report

4. 如果真实 Provider 输出不符合 AI Output Contract：
   - 记录实际输出片段
   - 记录错误提示
   - 不要放宽 JSON envelope
   - 优先修 prompt 或 Provider task message，不要绕过 parseAIOutput()

验收标准：
- npm run build 通过
- npm run test 通过
- npm run smoke 通过
- npm run smoke:project 通过
- 至少一个真实 Provider 的 ic provider test 通过
- 真实 Provider 在最小 TS 项目中能完成一次 task --go
- 若失败，必须给出失败类别、原始错误、下一步建议

完成后给我：
- 使用的 Provider / model
- API Key 配置方式（不要贴 Key）
- 实测命令列表
- task id
- gate JSON 结果
- 失败或风险列表
```

## 后续风险

- 该脚本仍使用 mock provider，不代表真实模型质量。
- 真实 Provider live acceptance 需要 dev1 或用户侧提供 API Key 环境变量。
- 当前临时项目的 build/lint/test 是轻量 Node 脚本，不运行真实 `tsc`。
