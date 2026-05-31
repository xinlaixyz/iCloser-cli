# AgentCode -- API 文档

## 接口概览

当前项目为 TypeScript CLI 工程，对外暴露的"接口"包括 CLI 命令和模块导出 API。
所有 CLI 命令支持 `--json` 标志以 JSON 格式输出结构化结果。

## CLI 命令接口

### 项目管理

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic init` | — | `[-f, --force]` | 初始化项目配置，自动识别项目类型 |
| `ic scan` | — | 无 | 扫描项目并更新索引 |
| `ic config` | — | `[args...]` | 查看/修改配置 (provider / model / mode / security) |
| `ic overview` | `info` | `[--json]` | 项目健康总览 |
| `ic doctor` | — | `[--json] [--strict]` | 检查项目执行就绪状态 |

### 任务系统

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic t <desc>` | `task` | `[--go] [--priority]` | 创建并执行任务 |
| `ic st [id]` | `status` | `[--json]` | 查看任务状态 |
| `ic y <id>` | `accept` | — | 确认并执行任务 |
| `ic n <id>` | `reject` | — | 拒绝并取消任务 |
| `ic cancel <id>` | — | — | 取消排队中的任务 |
| `ic rollback [id]` | — | `[--auto] [--dry-run] [--list]` | 回滚任务或 autopilot 快照 |
| `ic rollback --auto` | — | `[--dry-run]` | 回滚最近一次 autopilot 快照 |
| `ic rollback --list` | — | — | 列出所有 autopilot 回滚快照 |
| `ic rollback --auto --dry-run` | — | — | 预览回滚而不实际执行 |
| `ic d [id]` | `diff` | — | 查看代码 diff |
| `ic gate <id>` | `g` | `[--skip-gate] [--json]` | 执行六道门禁检查 |
| `ic l [id]` | `log` | — | 查看任务历史 |
| `ic r` | `report` | `[--regenerate]` | 查看最近任务报告 |

### Agent 管理

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic agent list` | `ag list` | `[--status] [--json]` | 列出所有 Agent |
| `ic agent create <name>` | — | `[--type] [--model]` | 创建 Agent |
| `ic agent start <id>` | — | `[task]` | 启动 Agent |
| `ic agent stop <id>` | — | — | 停止 Agent |
| `ic agent status <id>` | — | `[--json]` | 查看 Agent 状态 |
| `ic agent children <id>` | — | — | 查看子 Agent |
| `ic agent message <id>` | — | — | 发送消息 |
| `ic agent orchestrate <desc>` | — | — | 编排多 Agent 执行 |
| `ic loop` | — | `[--json]` | 查看三步循环状态 |

### 自动分析

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic auto [mode]` | `autopilot` | `[--json] [--go] [--yes] [--auto] [--module]` | 自动分析/文档/测试生成 |
| `ic auto docs --go --auto` | — | `[--yes]` | 写入文档，验证失败时自动回滚 |
| `ic auto tests --go --auto` | — | `[--module]` | 写入测试，验证失败时自动回滚 |
| `ic orchestrate <task...>` | `orch` | `[--execute] [--json] [--max-steps <n>]` | 自然语言任务 → 工具计划 → 执行/观察/恢复/证据；默认 dry-run 命令，显式 `--execute` 后才真实执行 |
| `ic intel <query>` | `code` | `[--json] [--callers]` | 代码智能查询 |
| `ic search <pattern>` | — | `[--json] [--web]` | 代码/网络搜索 |

### AI Provider

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic setup` | — | `[--provider] [--model] [--key]` | 首次安装向导 |
| `ic provider list` | — | `[--json]` | 列出可用 Provider |
| `ic provider use <name>` | — | `[model]` | 切换 Provider |
| `ic provider test` | — | — | 测试 Provider 连接 |
| `ic provider doctor` | — | `[--json]` | Provider 健康诊断 |

### 团队协作草稿

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `ic collab issue <text...>` | `ic issue <text...>` | `[--json]` | 从 issue/需求文本生成本地执行计划 |
| `ic collab pr` | `ic pr` | `[--title <title>] [--base <branch>] [--task <id>] [--json]` | 生成本地 PR 草稿，可附加任务报告/验证日志，不推送、不调用 GitHub API |
| `ic collab commit [message]` | `ic commit-draft [message]` | `[--json]` | 生成提交说明草稿，不执行 git commit |

### Claude Code 对标体验

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `ic diff explain` | `ic explain-diff` | `[--staged] [--json]` | 解释当前 diff 的变更意图、风险与建议验证 |

### 记忆系统 (Memory Kernel v1.0)

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic mem` | `memory` | — | 查看记忆摘要 |
| `ic mem status` | — | — | Memory Kernel 运行时状态 |
| `ic mem recall <查询>` | — | — | 手动检索相关记忆 (Top 5) |
| `ic mem bootstrap` | — | — | 从 git/代码配置重新引导 |
| `ic mem consolidate` | — | — | 手动触发记忆固化 |
| `ic mem forget` | — | — | 清理低分/过期记忆 |
| `ic mem inspect working` | — | — | 查看当前工作记忆 |
| `ic mem inspect semantic` | — | — | 查看语义规则树 |
| `ic mem inspect episodic` | — | — | 查看情景记忆 (近30天) |
| `ic mem rule add <规则>` | — | — | 手动添加语义规则 |
| `ic mem rule list` | — | — | 列出所有规则 |
| `ic mem rule delete <id>` | — | — | 删除规则 |
| `ic mem stats` | — | — | 记忆统计 |
| `ic mem events` | — | — | 查看用户输入事件 |
| `ic mem review` | — | — | 待确认记忆审查 |
| `ic mem approve/reject <id>` | — | — | 批准/拒绝记忆候选 |
| `ic mem edit [file]` | — | — | 创建/查看 Agent 记忆文件，默认 `AGENTS.md` |
| `ic mem edit list` | — | — | 查看当前项目规则 |
| `ic mem edit add <规则>` | — | — | 新增项目规则并同步写回 `AGENTS.md` |
| `ic mem edit delete <id或关键词>` | — | — | 删除项目规则并同步写回 `AGENTS.md` |
| `ic mem used <任务描述>` | — | — | 预览某个任务会采用哪些长期记忆 |
| `ic mem why <id或关键词>` | — | — | 解释某条记忆为什么会被召回或使用 |

> 调试: `ICLOSER_MEMORY_DEBUG=info ic mem status` 查看详细日志

### 其他

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic start` | `serve` | — | 启动项目开发服务 |
| `ic stop` | — | — | 停止后台服务 |
| `ic release report` | — | `[--json]` | 汇总类型检查、lint warning 预算、测试、smoke、macOS CI 与发布信任评分 |
| `ic audit` | — | `[-t <id>]` | 查看审计日志 |
| `ic` (无参数) | — | — | 进入 REPL 交互模式 |

### REPL 快捷命令

| 命令 | 参数 | 描述 |
|------|------|------|
| `/orchestrate <task...>` | 自然语言任务 | 在交互模式中启动工具编排，按“规划 → 执行 → 观察 → 恢复 → 证据”展示过程；默认 dry-run 命令 |

## 核心模块导出 API

### Memory Kernel (`src/core/memory/`)

```typescript
// 单例获取
import { getMemoryRuntime } from './core/memory/integration.js';
const runtime = await getMemoryRuntime(rootPath);

// 生命周期钩子
await runtime.onTaskStart(taskId, description);
await runtime.onTaskComplete(taskId, { filesChanged, verifyPassed, summary });
await runtime.onTaskError(taskId, error);

// Recall
const results = await runtime.recall.recall('修改钱包 UI');
// → RecallResult[] { type, source, content, score, raw }

// 上下文注入
import { getMemoryContextForLLM } from './core/memory/integration.js';
const memoryCtx = await getMemoryContextForLLM(rootPath, taskDescription);

// Bootstrap
import { bootstrapMemoryKernel } from './core/memory/bootstrap.js';
await bootstrapMemoryKernel(rootPath, runtime);

// 存储
import { ensureMemoryStore } from './core/memory/store.js';
const store = await ensureMemoryStore(rootPath);

// 调试
// ICLOSER_MEMORY_DEBUG=info node dist/index.js
```

### 扫描器 (`src/core/scanner.ts`)

```typescript
scanProject(options: ScanOptions): Promise<ScanResult>
saveProjectIndex(rootPath: string, index: ProjectIndex): Promise<void>
loadProjectIndex(rootPath: string): Promise<ProjectIndex | null>
serializeProjectIndex(index: ProjectIndex): SerializedProjectIndex
deserializeProjectIndex(raw: SerializedProjectIndex): ProjectIndex
```

### 任务引擎 (`src/core/task-engine.ts`)

```typescript
createTask(description: string, options?: { priority }): Task
createTasks(descriptions: string[], options?): Task[]
generatePlan(task, description, identity, index): TaskPlan
getTask(taskId: string): Task | undefined
updateTaskStatus(taskId: string, status: TaskStatus): void
getQueue(): Task[]
getNextTask(): Task | undefined
scheduleTasks(maxParallel: number): ScheduleSlot[]
persistTask(rootPath: string, task: Task): Promise<void>
loadTask(rootPath: string, taskId: string): Promise<Task | null>
listTasks(rootPath: string): Promise<Task[]>
cancelTask(taskId: string): boolean
```

### Agent 管理器 (`src/agent/manager.ts`)

```typescript
class AgentManager {
  constructor(aiConfig: AIConfig, maxConcurrent?: number)
  create(options: CreateOptions): AgentInstance
  start(agentId: string, task?: string): Promise<boolean>
  pause(agentId: string): boolean
  resume(agentId: string): Promise<boolean>
  stop(agentId: string): boolean
  get(agentId: string): AgentInstance | undefined
  list(options?: FilterOptions): AgentInstance[]
  sendMessage(message): AgentMessage
  broadcast(content: string, type?: AgentType): void
  createChildren(parentId, tasks): AgentInstance[]
  getTree(agentId: string): object
  orchestrate(description: string): Promise<OrchestrateResult>
  waitForAgent(agentId: string, timeoutMs: number): Promise<void>
}
```

### AI Provider (`src/ai/provider.ts`)

```typescript
createProvider(config: AIConfig): AIProviderAdapter
getAvailableProviders(): ProviderInfo[]
getProviderInfo(provider: AIProvider): ProviderInfo
getProviderStatus(config: AIConfig, provider?): ProviderStatus
smokeTestProvider(config: AIConfig): Promise<ProviderSmokeResult>
inferProviderFromApiKey(value: string, fallback?): AIProvider
maskApiKey(value: string): string
```

### 验证器 (`src/core/verifier.ts`)

```typescript
runVerification(rootPath, identity, task, options): Promise<VerifyResult>
resolveVerificationCommand(rootPath, identity, stage): Promise<Command | null>
```

### 输出协议 (`src/ai/output-contract.ts`)

```typescript
parseAIOutput(content: string): AIOutputContract
createAIOutputContract(summary, changes): AIOutputContract
validateAIOutputContract(value: unknown): AIOutputContract
```

## JSON 输出信封

所有 `--json` 模式输出遵循统一信封格式：

```json
{
  "contractVersion": 1,
  "kind": "事件类型",
  "data": { ... },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

支持的事件类型：`setup`, `config`, `task`, `task-list`, `gate-result`, `security-rules`, `autopilot-docs`, `autopilot-tests-written`, `intel-callers`, `overview`, `doctor`, `agent-list`, `agent-created`, `agent-status`, `loop-status`, `web-search`, `search`, `release-report`

## 认证与鉴权

系统无内置用户认证。AI Provider 的 API Key 通过以下方式配置：
1. `ic setup --key <apiKey>` 首次安装时配置
2. `ic provider key <provider> <apiKey>` 运行时配置
3. 环境变量注入（如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`）
4. API Key 保存到 `~/.icloser/config.json` 全局配置

## 配置参考

项目配置文件 `.icloser/icloser.json` 支持以下关键选项：

| 配置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `execution.autoRollbackOnFailure` | `boolean` | `false` | 设为 `true` 后，`ic auto docs --go` / `ic auto tests --go` 验证失败时自动回滚，无需每次传 `--auto` |
| `execution.defaultMode` | `string` | `"preview"` | 默认执行模式：`"preview"` 或 `"execute"` |
| `execution.maxRetries` | `number` | `3` | 最大重试次数 |
| `execution.maxParallelTasks` | `number` | `3` | 最大并行任务数 |

> 修改配置：`ic config execution.autoRollbackOnFailure true`

## 错误码

AI 调用错误分类（`src/ai/errors.ts`）：

| 错误码 | 含义 | 处理建议 |
|--------|------|----------|
| `MISSING_API_KEY` | API Key 未配置 | 运行 `ic provider env` 配置 |
| `AUTH_FAILED` | 认证失败（Key 无效） | 检查 API Key 是否正确 |
| `RATE_LIMITED` | 速率限制 | 等待后重试 |
| `OVERLOADED` | Provider 过载 | 切换 Provider 或稍后重试 |
| `INSUFFICIENT_QUOTA` | 配额不足 | 检查账户余额 |
| `MODEL_UNAVAILABLE` | 模型不可用 | 切换模型版本 |
| `CONTEXT_TOO_LARGE` | 上下文超长 | 减少上下文或增加 maxTokens |
| `UNKNOWN` | 未知错误 | 运行 `ic provider test` 诊断 |

---

> 本文档由 icloser autopilot 自动生成草稿。
