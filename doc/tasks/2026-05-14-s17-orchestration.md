# S17 多 Agent 编排

日期：2026-05-14
负责人：dev1 (S17.1 核心) + dev3 (S17 集成)

## S17.1 Agent 编排核心（dev1）

### 目标
AgentManager 支持 orchestrator 类型 Agent：拆解复杂任务 → 创建子 Agent → 并行执行 → 汇总结果。

### 交付
- `src/agent/manager.ts`：
  - `orchestrate(description)` — 完整编排流程
  - `waitForAgent(agentId, timeout)` — 轮询等待 Agent 完成
  - `getTree(agentId)` — 递归获取 Agent 层级树（含 children 递归）
  - `runAgent(agentId, task?)` — AI Provider 调用 + 结果写入
- `buildAgentSystemPrompt(agent)` — 按 Agent 类型生成系统提示词
- `AGENT_TYPE_PRESETS` — 6 种 Agent 类型的预设配置

### 编排流程
```
orchestrate("分析项目代码质量并修复")
  → 创建 orchestrator Agent
  → AI 拆解为 2-4 个子任务
  → 解析子任务描述
  → createChildren() 创建子 Agent
  → Promise.all(start) 并行启动
  → waitForAgent() 等待完成
  → 收集子 Agent 结果
  → 返回 { success, summary, childResults }
```

### 验收
```bash
npm run test -- agent-manager    # 14 tests passed
ic agent orchestrate "任务描述"   # 4 子 Agent 并行执行
```

## S17 集成（dev3）

### S17.2 CLI 集成
- `ic agent orchestrate <描述>` 命令
- REPL `/orchestrate <描述>` 命令

### S17.3 Mock Provider 编排支持
- Mock provider 识别编排提示词
- 返回结构化的子任务列表（而非对话回复）

## 验收总览
```bash
npm run build                   # ✅
npm run test                    # 326 passed / 37 files
ic agent orchestrate "..."      # ✅ 拆解 → 并行 → 汇总
/orchestrate "..."              # ✅ REPL 支持
```
