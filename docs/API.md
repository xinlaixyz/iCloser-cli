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
| `ic rollback <id>` | — | — | 回滚任务变更 |
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
| `ic auto [mode]` | `autopilot` | `[--json] [--go] [--yes]` | 自动分析/文档/测试生成 |
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

### 记忆系统

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic mem` | `memory` | `[args...]` | 查看/管理项目记忆 |
| `ic rule [constraint]` | — | `[--list] [--delete]` | 管理架构约束 |

### 其他

| 命令 | 别名 | 参数 | 描述 |
|------|------|------|------|
| `ic start` | `serve` | — | 启动项目开发服务 |
| `ic stop` | — | — | 停止后台服务 |
| `ic audit` | — | `[-t <id>]` | 查看审计日志 |
| `ic` (无参数) | — | — | 进入 REPL 交互模式 |

## 核心模块导出 API

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

支持的事件类型：`setup`, `config`, `task`, `task-list`, `gate-result`, `security-rules`, `autopilot-docs`, `autopilot-tests-written`, `intel-callers`, `overview`, `doctor`, `agent-list`, `agent-created`, `agent-status`, `loop-status`, `web-search`, `search`

## 认证与鉴权

系统无内置用户认证。AI Provider 的 API Key 通过以下方式配置：
1. `ic setup --key <apiKey>` 首次安装时配置
2. `ic provider key <provider> <apiKey>` 运行时配置
3. 环境变量注入（如 `ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`）
4. API Key 保存到 `~/.icloser/config.json` 全局配置

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

> 本文档由 iCloser autopilot 自动生成草稿。
