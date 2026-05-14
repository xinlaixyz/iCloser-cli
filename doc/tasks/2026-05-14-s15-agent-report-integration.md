# S15: Agent→Report 报告整合

日期：2026-05-14
负责人：dev3
状态：✅ 完成

## 目标

Agent 执行结果纳入任务报告。`ic r` 能看到：
- 哪些 Agent 参与了任务
- 每个 Agent 的输入/输出/token 消耗
- Agent 层级树可视化

## 交付

### 1. 新增类型 (`src/types.ts`)

```typescript
export interface AgentExecutionRecord {
  agentId: string;
  agentName: string;
  agentType: AgentType;
  status: 'done' | 'failed';
  startedAt?: string;
  completedAt?: string;
  result: AgentResult;
  sandboxLevel: 'none' | 'readonly' | 'isolated';
  model: string;
  parentAgentId?: string;
  childAgentIds: string[];
  tree?: Record<string, unknown>;  // getTree() 递归结构
}
```

`Task` 接口新增 `agentExecutions: AgentExecutionRecord[]` 字段。

### 2. Task→Agent 桥接修正 (`src/index.ts`)

`executeTask()` 中：
- 消除旧的 `_agentResult` / `_agentId` / `_agentSandbox` 隐藏属性
- Agent 创建时即初始化，AI 完成后写入 `task.agentExecutions.push(AgentExecutionRecord)`
- `agentExecutions` 包含完整的 Agent 执行记录，含 `getTree()` 层级树
- 沙箱级别从 `agent.sandboxLevel` 读取（不再用隐藏属性）

### 3. 报告增强 (`src/report/generator.ts`)

**Agent 执行摘要表：**
- 参与 Agent 数、成功/失败比
- Token 总用量、总耗时

**逐 Agent 详情：**
- 属性表：ID、类型、状态（✓/✗）、模型、沙箱、Token、耗时
- 产出文件列表（有则显示）
- 错误信息（有则显示）
- 输出内容（≤500 字全文，超过截断）

**层级树可视化：**
- `formatAgentTree()` 递归渲染 orchestrator → children 结构
- 树节点显示：状态图标 + 名称 + 类型 + Token
- 用 `├─` / `└─` 绘制树形结构

### 4. JSON 输出 (`src/cli/json.ts`)

`TaskJson` 新增 `agentExecutions` 字段，`serializeTask` 输出完整 Agent 执行记录。

### 5. 其他修正

- `src/core/task-engine.ts`: `createTask()` 初始化 `agentExecutions: []`
- `src/cli/repl.ts`: REPL 任务创建同步初始化 `agentExecutions: []`
- `src/agent/manager.ts`: 修复 `buildToolCapabilitySection` catch 块中引用未定义 `agent` 变量

## 测试

`tests/report-agent.test.ts` — 10 tests：
1. 含 agentExecutions 的任务报告包含 Agent 执行段
2. 多 Agent 成功/失败计数
3. 短输出全文展示
4. 长输出截断
5. Agent 错误显示
6. orchestrator 层级树渲染
7. 空 agentExecutions 不渲染 Agent 段
8. PR 描述不含 Agent 段
9. 沙箱级别显示
10. 多 Agent Token/耗时汇总

## 验收

```bash
npm run build                               # ✅
npx vitest run tests/report-agent.test.ts   # 10/10
npx vitest run                              # 336/336 (18 skipped)
npm run smoke                               # ✅
```
