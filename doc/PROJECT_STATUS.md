# iCloser Agent Shell — 项目状态总览

生成日期：2026-05-14
目的：整合 dev1/dev3 全部交付，核对架构预期一致性。

## 一、模块地图

```
src/
├── index.ts              # CLI 入口 (ic setup/init/scan/t/agent/provider...)
├── config.ts             # 配置加载/保存 (项目级 + 全局 ~/.icloser/)
├── types.ts              # 全局类型 (500+ 行)
│
├── cli/                  # 交互层
│   ├── repl.ts           # REPL 对话循环 (流式 AI、意图路由、/命令)
│   ├── loop-panel.ts     # 三步循环状态面板 (S7)
│   ├── output.ts         # 格式化输出 + 工具降级通知 (S7.4)
│   ├── theme.ts          # 终端 UI 设计系统
│   ├── choice-panel.ts   # 数字确认面板 (S5)
│   ├── system-approval.ts# 系统权限审批 (S5)
│   └── system-runner.ts  # 系统命令执行器 (S5)
│
├── core/                 # 核心服务层
│   ├── task-engine.ts    # 任务引擎 (创建/调度/并行/锁/DAG)
│   ├── task-loop.ts      # 三步任务循环 (收集→执行→验证) (S6/S7)
│   ├── tool-registry.ts  # 五工具能力注册表 (S7.1)
│   ├── scanner.ts        # 项目扫描器 (模块/API/DB/依赖/指纹/调用图 S6/S8/S9/S10)
│   ├── ast-parser.ts     # 多语言 AST 解析器 (TS/JS/Go/Py/Java/Kt/Swift/ObjC/SQL)
│   ├── verifier.ts       # 验证引擎 (compile→lint→test→e2e)
│   ├── context.ts        # 上下文管理 (Token 预算 + 网络搜索注入 S10)
│   ├── web-search.ts     # 网络搜索 (DuckDuckGo 免费) (S10)
│   ├── memory.ts         # 分层记忆系统 (S4)
│   ├── security.ts       # 安全层 (三级执行模式)
│   ├── autopilot.ts      # 大项目自动分析 (S6)
│   ├── autodoc.ts        # 自动文档生成 (S6)
│   ├── autotest.ts       # 自动测试生成 (S6)
│   ├── autopilot-repair.ts # 自动修复 (S6)
│   ├── autopilot-verify.ts # 自动验证 (S6)
│   ├── autopilot-rollback.ts# 变更回滚 (S6)
│   ├── autopilot-router.ts# 自然语言意图路由 (S6)
│   └── execution-chain.ts# 工程执行链定义 (S6)
│
├── agent/
│   └── manager.ts        # Agent 管理器 (创建/启停/通信/层级/并发) (S9)
│
├── ai/
│   └── provider.ts       # AI Provider 适配 (Mock/Claude/DeepSeek/OpenAI/Qwen)
│
├── gate/
│   └── checker.ts        # 六道门禁检查
│
├── report/
│   └── generator.ts      # 中文报告生成
│
├── skill/
│   └── manager.ts        # Skill 管理器 (内置 5 个)
│
└── utils/
    ├── fs.ts             # 文件系统工具
    ├── git.ts            # Git 工具
    └── detect.ts         # 项目自动识别 (11 种语言)
```

## 二、分阶段交付

| 阶段 | 负责人 | 内容 | 状态 |
|------|--------|------|------|
| S1 | dev1+dev2 | CLI 骨架、项目识别、扫描器、任务引擎、安全、Provider 管理 | ✅ |
| S2 | dev1+dev2 | 真实 Provider 连接、AI Output Contract、新手引导 | ✅ |
| S3 | dev1+dev2 | 首次使用向导、API Key 安全输入、REPL Smoke | ✅ |
| S4 | dev1 | Agent OS 上下人协同记忆、审计日志 | ✅ |
| S5 | dev2 | 意图路由、系统操作审批面板、文件写入回执 | ✅ |
| S6 | dev2 | 自动文档/测试/修复/验证、三步循环、执行链 | ✅ |
| S7 | dev2+dev1 | 工具注册表、REPL 循环面板、任务主链 Hook、降级文案 | ✅ |
| S8 | dev1 | tree-sitter AST 解析器 (TS/JS) + scanner 集成 | ✅ |
| S9 | dev1 | **Agent Manager** — 多 Agent 编排 (核心) | ✅ |
| S9 | dev3 | 多语言 AST (Go/Py/Java/Kt/Swift/ObjC/SQL) | ✅ |
| S10 | dev3 | 跨文件调用图、增量扫描、网络搜索 (DuckDuckGo) | ✅ |
| S12 | dev3 | Agent CLI/REPL 集成、web-search smoke、agent smoke | ✅ |
| S13 | dev3 | Task→Agent 自动桥接 (`executeTask` Agent 创建) | ✅ |
| S14 | dev3 | Agent 安全沙箱 (`checkSandboxWrite` / `filterSandboxedFiles`) | ✅ |
| S15 | dev3 | Agent→Report 报告整合 (`agentExecutions` / 层级树可视化) | ✅ |
| S16 | dev3 | 真实验收 + 文档完善 | ✅ |

> S11 未单独出现——scanner.ts 中的 fingerprint + callGraph 在 DEV2-S6 阶段已定义，S10/S12 中完成为 `CrossFileCallEdge` + `fileFingerprints`。

## 三、dev1 S9 交付

### Agent Manager (`src/agent/manager.ts`)

```
AgentManager
├── create({name, type, model, context, tools, parentId, sandbox, budget}) → AgentInstance
├── start(agentId, task?) → boolean (调用 AI Provider 执行)
├── pause(agentId) → boolean
├── resume(agentId) → boolean
├── stop(agentId) → boolean (递归停止子 Agent)
├── get(agentId) → AgentInstance | undefined
├── list({status?, type?, parentId?}) → AgentInstance[]
├── activeCount() → number
├── sendMessage({from, to, content, type}) → AgentMessage
├── getMessages(agentId) → AgentMessage[]
├── broadcast(content, type?) → void
├── writeContext(key, value) → void
├── readContext(key) → Record | undefined
├── clearContext() → void
├── createChildren(parentId, tasks[]) → AgentInstance[]
└── getTree(agentId) → hierarchy tree
```

Agent 类型：`task | review | verify | skill | explore | orchestrator`
Agent 状态：`idle → running → done/failed` (可 pause/resume)
并发控制：`maxConcurrent` (默认 3)

### S17 编排 — dev1 核心

```
orchestrate(description)
  → 创建 orchestrator Agent
  → AI 拆解为 2-4 子任务
  → createChildren() + Promise.all(start)
  → waitForAgent(timeout) 轮询
  → 收集 childResults → 汇总返回
```

`getTree(agentId)` — 递归层级树（含 result 摘要）
`buildAgentSystemPrompt(agent)` — 按类型生成系统提示词
`AGENT_TYPE_PRESETS` — 6 种 Agent 预设（模型/工具/提示词）

### S18 工具调用 — dev3 核心

```
src/core/tool-executor.ts
  ├── buildToolDefinitions() → ToolDefinition[]
  ├── executeToolCall(name, args, rootPath) → string
  └── 五工具：read_file / search_code / run_command / web_search / code_intel

executeTask 内建工具调用循环（最多 5 轮）：
  AI → tool_calls → execute → inject results → AI thinks again → final output
```

### 测试覆盖

`tests/agent-manager.test.ts` — 14 项：生命周期(5)、通信(2)、共享上下文(2)、层级(2)、并发(2)、暂停恢复(1)
`tests/agent-sandbox.test.ts` — 8 项：none/readonly/isolated 检查、文件过滤、路径穿越
`tests/report-agent.test.ts` — 10 项：Agent 执行摘要、多 Agent 统计、输出截断、层级树、沙箱级别、Token 汇总

## 四、S15 Agent→Report 整合

### 新增类型

```
src/types.ts
  ├── AgentExecutionRecord    # agentId, name, type, status, result, sandboxLevel, tree
  └── Task.agentExecutions    # AgentExecutionRecord[] (替代旧的 _agentResult/_agentId)
```

### 报告增强 (`src/report/generator.ts`)

- **Agent 执行摘要**：参与 Agent 数、成功/失败比、Token 总用量、总耗时
- **逐 Agent 详情**：ID、类型、状态、模型、沙箱、Token/耗时、产出、输出（短则全文，长则截断）
- **层级树可视化**：orchestrator 编排场景下渲染 `getTree()` 递归结构
- **JSON 输出**：`ic st --json` 包含 `agentExecutions` 数组

### 桥接修正

- `executeTask()` 中 `_agentResult` / `_agentId` / `_agentSandbox` 隐藏属性全部替换为 `task.agentExecutions.push(AgentExecutionRecord)`
- REPL 任务创建同步初始化 `agentExecutions: []`
- JSON 序列化器 (`serializeTask`) 输出 `agentExecutions`

## 五、分工总览

| 阶段 | dev1 | dev3 |
|------|------|------|
| S8 | AST 解析器 TS/JS | — |
| S9 | **Agent Manager** 核心引擎 | 多语言 AST (Go/Py/Java/Kt/Swift/ObjC/SQL) |
| S10 | — | 网络搜索 DuckDuckGo + 上下文注入 |
| S11 | — | 跨文件调用图 + 增量扫描 |
| S12 | — | Agent CLI/REPL + smoke |
| S13 | — | ⬆️ Task→Agent 桥接 (executeTask 自动创建 Agent) |
| S14 | — | ⬆️ Agent 安全沙箱 (agent/manager.ts) |
| S15 | — | ⬆️ Agent→Report 整合 (agentExecutions + 层级树) |
| S16 | — | ⬆️ 真实验收 + 文档完善 |
| S17 | **Agent 编排** (orchestrate/getTree/waitForAgent) | CLI/REPL 集成 + Mock 编排支持 |
| S17.4 | — | ⬆️ 全局记忆注入 AI 上下文 (用户偏好/技术栈/踩坑) |
| S17.5 | — | ⬆️ Web 搜索结果注入 AI prompt (3 个 Provider 适配器) |
| S17.6 | — | ⬆️ AST 调用图注入 AI prompt (3 个 Provider 适配器) |
| S18 | — | AI 工具调用 (tool-executor) |

## 五、架构预期核对

### ✅ 一致的

| 架构预期 (ARCHITECTURE.md) | 实际状态 |
|------|------|
| 分层架构：Human→CLI→Core→Runtime | ✅ 完全一致 |
| 五大工具：文件/搜索/命令/网络/代码智能 | ✅ tool-registry.ts 实现 |
| 三步循环：收集→执行→验证 | ✅ task-loop.ts 实现 |
| Agent Manager 在核心服务层 | ✅ src/agent/manager.ts |
| 记忆系统分层：短期/任务/长期 | ✅ src/core/memory.ts |
| 安全三级执行：preview/execute/privileged | ✅ src/core/security.ts |
| Provider 适配：Claude/DeepSeek/OpenAI/Qwen/Mock | ✅ src/ai/provider.ts |
| AI Output Contract JSON | ✅ src/ai/ 实现 |

### ⚠️ 偏差

| 架构预期 | 实际 | 严重度 |
|------|------|--------|
| 外部知识接口 "默认不持久化" | web-search 有 24h 缓存但不符合规范 | 低 |
| Go/Python tree-sitter ABI | Node 24 环境 ABI 不兼容，已降级为 regex | 低 |
| 大项目性能 | 10K+ 文件项目扫描性能优化待做 | 低 |

## 六、当前指标

```
测试:    354 passed / 38 files / 0 failed / 0 skipped
Smoke:   release ✅  agent ✅  web-search ✅  loop ✅  multilang ✅  repair ✅
构建:    tsc 零错误
支持语言: TS JS Go Python Java Kotlin Swift ObjC SQL
Provider: Mock Claude DeepSeek(已验证) OpenAI Qwen
CLI命令:  setup init scan t st d y n g l r mem audit rule config doctor provider agent start stop search loop intel
REPL命令: /help /doctor /scan /run /agents /agent /apikey /status /memory /search /intel /context /orchestrate
```
