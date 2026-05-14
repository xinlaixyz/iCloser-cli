# DEV2-S6.3 Auto Test Planner

日期：2026-05-13
负责人：dev2
状态：已完成

## 目标

在 Project Autopilot 中增加自动测试规划能力。系统可以自动分析项目测试缺口，给出模块优先级、建议测试文件和验证命令，但不直接批量写测试，避免大项目失控修改。

## 用户价值

用户只需要说“检查测试缺口”或运行 `ic autopilot tests`，系统就能告诉用户：

- 哪些模块缺测试。
- 哪些模块只有部分测试。
- 应该先补哪些模块。
- 应该运行什么验证命令。
- 后续写测试必须进入中文确认面板。

## 修改文件

- `src/core/autopilot.ts`
- `src/index.ts`
- `tests/autopilot.test.ts`
- `scripts/autopilot-smoke.mjs`
- `doc/PROJECT_AUTOPILOT.md`
- `doc/DEVELOPMENT.md`

## CLI

```bash
ic autopilot tests
ic auto tests
ic autopilot tests --json
```

JSON 输出：

```json
{
  "version": 1,
  "kind": "autopilot-test-plan",
  "data": {}
}
```

## 验收标准

- `npm run build` 通过。
- `npm run test -- autopilot` 通过。
- `npm run smoke:autopilot` 通过。
- `npm run test` 通过。
- `npm run lint` 通过。
- `npm run smoke:all` 通过。

## 后续

S6.4 可以在该测试计划基础上做“按模块生成测试文件”：一次只生成一个模块的测试，写入前进入中文 Choice Panel，写入后自动运行建议验证命令。
