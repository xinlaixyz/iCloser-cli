# S3.6 CI Full Smoke Gate

日期：2026-05-13
负责人：dev2

## 背景

S3.5 已交付 `npm run smoke:all` 作为阶段交接聚合入口。本任务确认该入口与 CI 的关系，并明确 CI 最小门槛与本地完整验收的界限。

## 审计结论

### 当前状态

| 文件 | CI 门槛 | 本地交接门槛 |
|------|---------|------------|
| `.github/workflows/smoke.yml` | `npm run smoke` | — |
| `README.md` "Release Smoke Test" | `npm run smoke` | `npm run smoke:all` |
| `README.md` "CI Release Gate" | `npm run smoke` | — |
| `doc/DEVELOPMENT.md` S1 bar | `npm run smoke` | `npm run smoke:all` |
| `doc/DEVELOPMENT.md` S3.5 | — | `npm run smoke:all` |

**结论：文档无矛盾。** CI 最低门槛统一为 `npm run smoke`，阶段交接/完整验收统一为 `npm run smoke:all`。

### `npm run smoke:all` 不适合直接接入 CI

| 因素 | 说明 |
|------|------|
| 执行时间 | 6 个子步骤累计约 19 分钟，超出当前 CI 10 分钟 timeout |
| REPL 交互 | `smoke:repl` 需要 stdin/stdout TTY 交互，CI 环境无 TTY |
| 资源消耗 | 创建临时 TypeScript 项目 + 多次 spawn，CI runner 资源波动大 |
| 收益 | `npm run smoke` 已覆盖 build/test/task/gate/report 核心链 |

### 决策

- **CI 最低门槛**：保持 `.github/workflows/smoke.yml` 运行 `npm run smoke`，不修改。
- **阶段交接/验收门槛**：`npm run smoke:all`，本地手动运行。
- **README 和 DEVELOPMENT 已有对应说明**，无需额外修改。

## 文档确认

### README.md "Release Smoke Test"

- "Run before every push or PR merge: `npm run smoke` + `npm run smoke:project`" — 本地建议，比 CI 更全。
- "For full local acceptance before a handoff, run: `npm run smoke:all`" — 交接入口。
- "CI Release Gate" — CI 只跑 `npm run smoke`。

### doc/DEVELOPMENT.md

- "S1 当前最低门槛: `npm run smoke` + `npm run smoke:project`"
- "阶段交接或完整验收门槛: `npm run smoke:all`"
- "PR 合并门槛：必须 `npm run smoke` 通过。CI 绿灯是合并的必要条件。"

### 结论

两份文档的 CI / 本地验收口径一致，未发现矛盾。

## 验收

- [x] `npm run smoke:all` 通过
- [x] 文档无 CI/本地验收口径矛盾
- [x] 未引入真实 API Key 依赖
- [x] 不影响 S3.5 full-smoke aggregator
