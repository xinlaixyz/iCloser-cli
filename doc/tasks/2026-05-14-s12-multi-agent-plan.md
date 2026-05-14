# S12 多 Agent 执行 + 产品完善计划

日期：2026-05-14
前置：S9 AgentManager（dev1 已交付，14 tests passed）

## 一、现状评估

### S9 交付物

| 文件 | 内容 | 状态 |
|------|------|------|
| `src/agent/manager.ts` | AgentManager 类：创建/启停/暂停/恢复/消息/共享上下文/层级/并发 | ✅ |
| `tests/agent-manager.test.ts` | 14 项测试（生命周期/通信/上下文/层级/并发） | ✅ 全过 |
| `src/types.ts` | AgentType/AgentStatus/AgentInstance/AgentMessage 类型 | ✅ |

### S9 缺口

| 问题 | 严重度 |
|------|--------|
| AgentManager 没有 CLI 入口（无 `ic agent` 命令） | 高 |
| Task Engine 不知道 Agent 存在，任务不能自动创建 Agent | 高 |
| REPL 有 `getAgentManager()` 但没有 `/agent` 命令 | 中 |
| Agent 执行结果不进报告系统 | 中 |
| Agent 没有 sandbox 隔离（定义了 `sandboxLevel` 但未实现） | 低 |

### 全局缺口

| 问题 | 来源 |
|------|------|
| 网络搜索 smoke 测试未完成 | S10.5 遗留 |
| `ic agent` 命令不存在 | CLI 缺失 |
| 多 Agent 工作流无法触发 | 编排缺失 |

## 二、S12 任务

### S12.1 Agent CLI 命令（dev3）

```
ic agent create <name> --type task|review|verify|orchestrator
ic agent start <id> [task]
ic agent stop <id>
ic agent list [--status running]
ic agent status <id>
ic agent children <id>
ic agent message <id> <content>
```

- 新增 CLI 子命令在 `src/index.ts`
- 支持 `--json` 输出
- 测试：`tests/agent-cli.test.ts`

### S12.2 Task → Agent 自动桥接（dev3）

`ic t "分析项目安全漏洞" --go` 执行时：
1. Task Engine 创建 task
2. 自动创建 orchestrator Agent
3. Agent 调用 AI 生成子任务
4. 子任务分派给 review/verify Agent
5. 结果汇总进 task report

- 修改 `src/core/task-engine.ts`：`executeTask` 创建 Agent
- 修改 `src/index.ts`：task chain 接入 AgentManager

### S12.3 REPL `/agent` 命令（dev3）

REPL 内支持：
```
/agent create 代码审查员 --type review
/agent start <id> 审查 src/core/task-loop.ts
/agent list
/agent status <id>
```

- 修改 `src/cli/repl.ts`：新增 `/agent` slash 命令

### S12.4 网络搜索 smoke（dev3）

第 10.5 补完：
- `scripts/web-search-smoke.mjs`
- 接入 `smoke:all`
- 验证 DuckDuckGo 真实可用

### S12.5 Agent smoke（dev3）

- `scripts/agent-smoke.mjs`
- 创建 orchestrator + 2 task agents
- 验证 agent 层级通信
- 接入 `smoke:all`

## 三、验收

```bash
npm run build
npm run test                          # 全量 ≥ 320 tests
npm run smoke:agent
npm run smoke:web-search
npm run smoke:all
```

必须满足：
- `ic agent create` 创建 Agent 并返回 ID
- `ic agent start <id> "任务"` 实际调用 AI（mock 或真实）
- Task 创建后自动生成 Agent 并执行
- REPL `/agent list` 列出当前 Agent
