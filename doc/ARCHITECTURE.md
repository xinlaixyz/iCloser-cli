# icloser Agent Shell — 架构设计文档

## 一、总体架构

icloser Agent Shell 采用**分层架构**，自上而下分为 Human Governance / Auto Review / CLI 交互层、核心服务层、记忆与审计层、基础工具层和项目运行时层。

```
┌──────────────────────────────────────────────────────────────┐
│        Human Governance / Auto Review Layer                   │
│   任务目标  │ 自动评级 │ 默认处理 │ 高风险确认 │ 策略修正      │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────────────────────────────────────────┐
│                    CLI / REPL 交互层                          │
│     ic 命令解析  │  交互式 REPL  │  Theme 渲染  │  中文输出    │
└──────────────────────────┬───────────────────────────────────┘
                           │
         ┌─────────────────┼───────────────────┐
         ▼                 ▼                   ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────────┐
│ Task Engine │  │ Agent Manager│  │  Skill Manager   │
│ (调度/锁)    │  │ (生命周期)    │  │  (安装/组合)      │
└──────┬──────┘  └──────┬───────┘  └──────┬───────────┘
       │                │                  │
       └────────────────┼──────────────────┘
                        │
         ┌──────────────┼──────────────────┐
         ▼              ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│Project Index │ │Context Mgr   │ │ AI Runtime   │
│Engine        │ │              │ │ Manager      │
│              │ │ Token 预算    │ │              │
│ detect       │ │ 分层压缩      │ │ Provider适配  │
│ scanner      │ │ 动态调整      │ │ Claude       │
│ AST 解析     │ │ 记忆整合      │ │ DeepSeek     │
│ 依赖图谱     │ │              │ │ OpenAI       │
│ 风格检测     │ │              │ │ Qwen         │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
         ┌──────────────┼──────────────────┐
         ▼              ▼                  ▼
┌────────────┐ ┌──────────────┐ ┌──────────────┐
│Verify      │ │Report Engine │ │Security Layer│
│Engine      │ │              │ │              │
│ compile    │ │ 中文报告       │ │ 文件保护      │
│ lint       │ │ diff 生成     │ │ 命令拦截      │
│ unit-test  │ │ PR 描述       │ │ 三级执行模式   │
│ integration│ │ 推理链         │ │ 审计日志      │
│ e2e        │ │              │ │              │
└──────┬─────┘ └──────┬───────┘ └──────┬───────┘
       │              │                │
       └──────────────┼────────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                     Memory System                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ 短期记忆      │ │ 任务记忆      │ │ 长期知识库            │ │
│  │ REPL/session │ │ .icloser/tasks│ │ ~/.icloser/global-... │ │
│  └──────────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 外部知识接口 (Provider / API / Search) 默认不持久化       │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                     Project Runtime                           │
│       fs-extra  │  git 操作  │  child_process  │  fast-glob   │
└──────────────────────────────────────────────────────────────┘
```


### 1.1 基础工具层五大类

Task Thinking Loop 的三步循环必须绑定五大类工具：

| 工具类别 | 所属层 | 用途 | 缺失时处理 |
| --- | --- | --- | --- |
| 文件操作 | Project Runtime / fs | 读文件、改代码、新建文件、重命名 | 停止写入，只输出计划和路径 |
| 搜索 | Project Runtime / scanner | 文件名搜索、正则搜索、错误文本定位 | 降级为项目索引和上下文摘要 |
| 执行命令 | Project Runtime / child_process | npm、git、测试、构建、启动服务器 | 标记验证不可用，不假装成功 |
| 网络搜索 | 外部知识接口 | 查文档、查错误、查版本兼容性 | 使用本地文档、依赖源码和记忆 |
| 代码智能 | 语言插件 / LSP | 类型错误、跳转定义、找引用 | 降级为搜索、扫描和编译错误 |

循环绑定关系：

- 收集上下文：文件操作 + 搜索 + 网络搜索 + 代码智能
- 执行操作：文件操作 + 搜索 + 执行命令
- 验证结果：文件操作 + 搜索 + 执行命令 + 代码智能
## 二、项目源码结构

```
src/
├── index.ts                 # CLI 入口，commander 命令注册
├── config.ts                # 全局/项目级配置管理
├── types.ts                 # 核心类型定义（415行，所有模块共享）
│
├── cli/                     # CLI / REPL 交互层
│   ├── repl.ts              # 交互式 REPL（流式 AI 对话）
│   ├── output.ts            # 格式化输出（颜色、图标、状态）
│   └── theme.ts             # 终端 UI 设计系统（品牌色、Box 绘制）
│
├── core/                    # 核心服务层
│   ├── scanner.ts           # 项目扫描器（文件发现、模块提取、API检测、依赖分析、风格指纹）
│   ├── task-engine.ts       # 任务引擎（创建、调度、并行、文件锁、DAG 依赖）
│   ├── verifier.ts          # 验证引擎（compile → lint → unit-test → integration → e2e）
│   ├── context.ts           # 上下文压缩管理器（Token 预算、分层压缩、动态调整）
│   ├── memory.ts            # 分层记忆系统（短期/任务/长期，长期需人类审核）
│   └── security.ts          # 安全层（三级执行模式、文件保护、命令拦截、审计日志）
│
├── agent/
│   └── manager.ts           # Agent 管理器（创建/暂停/恢复/停止/通信/共享上下文）
│
├── gate/
│   └── checker.ts           # 门禁检查器（测试/安全/推理/报告/回滚/Git 六道门禁）
│
├── ai/
│   └── provider.ts          # AI Provider 适配层（Claude/DeepSeek/OpenAI/Qwen）
│
├── skill/
│   └── manager.ts           # Skill 管理器（内置5个/安装/启用/组合/自动生成）
│
├── report/
│   └── generator.ts         # 报告生成器（中文报告/diff/推理链/验证日志/PR描述）
│
└── utils/
    ├── fs.ts                # 文件系统工具（读写/JSON/glob/备份/Token估算）
    ├── git.ts               # Git 工具（状态/提交/diff/worktree/stash）
    └── detect.ts            # 项目自动识别（语言/框架/DB/构建系统/测试框架/部署形态）
```

## 三、核心模块设计

### 3.1 项目识别引擎 (`src/utils/detect.ts`)

启动时自动识别项目身份，采用**打分制**而非简单的文件存在检测：

| 识别维度 | 打分规则 | 例子 |
|---------|---------|------|
| 语言 | tsconfig.json +10, .ts 文件 +5 | TypeScript |
| 框架 | package.json deps 精确匹配 | React / Next.js / Express |
| 数据库 | 连接字符串特征 + ORM 依赖 | PostgreSQL / MySQL / SQLite |
| 构建系统 | 锁文件检测优先级: pnpm > yarn > npm | pnpm |
| 测试框架 | devDependencies 特征匹配 | Vitest / Jest / pytest |
| 部署形态 | Dockerfile / k8s yaml / serverless.yml | Docker |

**关键设计决策：** 识别结果直接写入 `ProjectIdentity` 类型，后续所有模块依赖这个类型做决策（选择编译命令、验证管线等）。

### 3.2 项目扫描器 (`src/core/scanner.ts`)

分层扫描，每层独立可测试：

```
Phase 1: detectProject()     → ProjectIdentity（语言/框架/DB）
Phase 2: findFiles()         → 源码文件列表（排除测试、声明文件）
Phase 3: filterBySize()      → 过滤超大数据文件、二进制文件
Phase 4: extractModules()    → 按目录分组、提取 exports/imports
Phase 5: extractApiEndpoints() → Express/Decorator/Go 风格路由检测
Phase 6: extractDbSchema()   → migration 目录 + ORM 检测
Phase 7: extractDependencies() → package.json / go.mod / requirements.txt
Phase 8: buildDependencyGraph() → 内部模块依赖 DAG
Phase 9: extractStyleFingerprint() → 命名/缩进/引号/分号习惯采样
Phase 10: detectArchitecturePattern() → MVC / Clean / Layered / Microservices
```

**S1 当前实现状态：**
- `scanProject()` 是当前唯一推荐扫描入口，CLI `icloser scan` 与 REPL `/scan` 都应复用它。
- 扫描结果通过 `saveProjectIndex(rootPath, index)` 写入 `.icloser/index.json`。
- 读取索引用 `loadProjectIndex(rootPath)`，该函数会把 JSON 中的 `dependencyGraph` 恢复成 `Map<string, string[]>`。
- 模块分组粒度按目录归并：根级源码文件归入 `src`，二级目录归入 `src/core`、`src/cli`、`src/utils` 等。
- 当前仍是启发式扫描（正则 + 文件结构 + 依赖文件），不是完整 AST 引擎。S1 目标是产出稳定、可持久化、可供 context/task 使用的索引。

**索引文件结构：**

```text
.icloser/index.json
├── identity             # ProjectIdentity
├── modules              # ModuleInfo[]
├── apis                 # ApiEndpoint[]
├── database             # DbSchemaInfo
├── dependencies         # DependencyInfo[]
├── dependencyGraph      # JSON object，读取时恢复为 Map
├── styleFingerprint     # StyleFingerprint
├── architecturePattern  # 架构模式摘要
├── rootPath
└── lastScan
```

### 3.3 任务引擎 (`src/core/task-engine.ts`)

任务生命周期状态机：

```
QUEUED → SCHEDULED → RUNNING → VERIFYING → COMPLETED
  │        │           │           │
  │        │           │           └──→ FAILED（可重试）
  │        │           │
  │        │           └──→ BLOCKED（文件冲突/依赖未完成）
  │        │
  │        └──→ CANCELLED
  │
  └──→ 依赖检查失败 → 保持 QUEUED
```

**并行安全机制：**
- **文件锁**：`Map<string, string>` file → taskId，修改前锁定
- **冲突预检测**：入队时检查，阻塞而非失败
- **依赖 DAG**：`Map<string, string[]>` taskId → dependsOn
- **条件调度**：`scheduleTasks()` 按优先级 + 无冲突 + 无阻塞排序

### 3.4 验证引擎 (`src/core/verifier.ts`)

验证流水线按语言自动选择命令：

| 阶段 | TypeScript | Go | Python | Rust |
|------|-----------|-----|--------|------|
| compile | `tsc --noEmit` | `go build ./...` | — | `cargo check` |
| lint | `eslint` | `go vet` | `flake8`/`pylint` | `cargo clippy` |
| unit-test | `vitest`/`jest` | `go test` | `pytest` | `cargo test` |
| integration | vitest integration config | `go test -tags=integration` | `pytest -m integration` | — |

**自动修复循环：** 每轮失败后记录错误详情，最多 3 轮，超出后回滚并输出诊断报告。

**S1 REPL 验证入口：**
- REPL `/verify` 当前优先执行项目脚本：TypeScript/JavaScript 项目优先 `npm run typecheck`，没有则 `npm run build`，再兜底 `npx tsc --noEmit`。
- Windows 下通过 `cmd.exe /d /s /c` 执行 npm/npx，避免 `spawnSync npm.cmd EINVAL`。
- 不允许用 `|| echo ok` 这类 shell 拼接吞掉失败；验证失败必须返回失败状态和错误输出。

### 3.5 上下文压缩管理器 (`src/core/context.ts`)

在 Token 预算内最大化信息密度：

```
原始上下文（50K+ tokens）
    │
    ▼ 相关性评分（关键词 × 文件名 × 内容密度）
    │
    ▼ 分层压缩：
    ├─ score ≥ 0.8 → full（完整源码）
    ├─ score 0.5-0.8 → skeleton（函数签名 + 关键逻辑）
    ├─ score 0.3-0.5 → summary（一行职责 + 导出符号）
    └─ score < 0.3 → 不注入
    │
    ▼ Token 预算分配：
    ├─ 系统提示词：~2K
    ├─ 项目元信息：~1K
    ├─ 任务相关代码：~60-80%
    ├─ 历史记忆：~1-2K
    └─ 缓冲预留：10%
```

**S1 当前接入方式：**
- 已有底层入口：`assembleContext(task, index, memory, identity, options)`。
- 推荐给 CLI task 主链使用的新入口：`assembleContextFromProject(rootPath, task, options)`。
- `assembleContextFromProject()` 会优先读取 `.icloser/index.json`；索引不存在且 `scanIfMissing !== false` 时，会自动调用 `scanProject()` 并保存索引。
- 该入口同时加载 `.icloser/memory.json`，调用方不需要自己处理索引和记忆加载细节。
- REPL 普通对话的 rich context 已优先使用该入口，失败时才回退会话内轻量摘要。
- S1 相关性评分支持中英文混合任务：英文按 token/path/camelCase 拆词，中文常见工程词会映射到英文代码标识，例如“用户”→ `user`，“校验/验证”→ `validate`/`validation`/`check`，“接口/路由”→ `api`/`route`/`handler`。

### 3.6 双层级记忆系统 (`src/core/memory.ts`)

S4 目标将当前“双层级记忆”升级为“上下人处理模式下的分层可审计记忆”。核心原则是：任务记忆可由 Agent 自动记录，低风险项目记忆可自动治理；全局长期知识必须来自明确用户确认或团队策略配置。

**层级一：短期记忆（REPL session / task runtime）**
- 会话上下文、即时执行结果、所有用户输入、Agent 输出、临时推理
- 只在当前会话或任务中直接使用
- 会话结束或任务完成后归档为任务摘要，或直接丢弃
- 用户输入包括自然语言任务、REPL 消息、斜杠命令、确认/拒绝、审批动作、修正意见和新增约束
- 敏感输入必须脱敏保存，或只保存审计摘要

**层级二：任务记忆（`.icloser/tasks/<task-id>/` + `.icloser/memory.json`）**
- 架构约束（ArchitectureRule）、决策记录（DecisionRecord）、任务历史（TaskRecord）
- 用户反馈（FeedbackRecord，带衰减因子）、上下文快照（ContextSnapshot）
- 超过 100 条记录自动压缩（保留最近 50 条，其余合并为摘要）

**层级三：长期知识库（`~/.icloser/global-memory/memory.json`）**
- 按技术栈组织（`go-gin-postgres`、`react-nextjs` 等）
- 跨项目模式提取（每 10 个任务触发一次）
- 踩坑记录（PitfallRecord）、用户偏好（UserPreferences）、Skill 使用历史
- Agent 只能生成 `proposed` 候选；`approved` 后才进入后续任务上下文

**层级四：外部知识接口**
- Provider / API / 搜索 / 数据源调用
- 默认实时查询，不持久化
- 需要沉淀时先写入任务记忆证据，再进入长期知识候选

**记忆元数据要求：**
- `source`：来源，例如 user / agent / verifier / external-api
- `rawInputRef`：用户原始输入事件引用；敏感输入只保存脱敏引用
- `taskId`：关联任务
- `agentId`：提出或写入的 Agent
- `reviewStatus`：draft / proposed / approved / rejected / archived
- `version`：版本号
- `evidence`：证据路径或摘要，例如 report.md、verify.log、diff

### 3.6.1 Human Governance / Auto Review Layer

上下人处理模式把人类控制权显式纳入系统架构，但默认不把审核负担交给用户。Agent OS 先自动分类、压缩、去重、风险评级和默认处理，只在高风险或不可逆场景用简单选择题打断。

```text
Human Task Input
  → Agent Task Parsing & Decomposition
  → Subtasks Assigned to Agents
  → Short-term Memory Logging
  → Execution & Data Collection
  → Task Memory Update
  → Automatic Review / Compression
    ├─ Low Risk → Auto Archive / Auto Approve Project Memory
    ├─ Medium Risk → Batch Candidate, Ask Later
    └─ High Risk → Simple Human Choice
  → Archival / Template Extraction
```

**职责边界：**
- 人类：表达目标、确认少数高风险动作、修正系统误解、保留最终否决权
- Agent OS：执行、初步判断、数据处理、任务记忆记录、自动压缩、自动风险评级、低风险默认处理
- 外部接口：实时查询，默认不直接写长期记忆

**架构约束：**
- 所有用户输入先记录为短期记忆事件，再按任务归档或生成长期候选
- 低风险项目内记忆可自动归档或自动 approved，并保留撤销入口
- 全局长期知识不能静默 approved，必须来自明确用户确认或团队策略配置
- 高风险确认必须是低认知负担选择题，并提供推荐默认项
- 用户修正 Agent 结论时，保留原始候选和修正版本
- 任务报告必须展示系统自动处理的记忆、风险评级和待确认候选

### 3.7 安全层 (`src/core/security.ts`)

三级执行模式：

| 模式 | 可读取 | 可修改源码 | 可修改配置 | 可执行命令 |
|------|--------|-----------|-----------|-----------|
| preview | ✓ | ✗ | ✗ | ✗ |
| execute | ✓ | ✓ | ✗ | 构建/测试 |
| privileged | ✓ | ✓ | ✓（确认） | ✓（危险命令确认） |

**硬性保护：**
- 敏感文件白名单（`.env`, `credentials.*`, `*.pem`）→ 任何模式不可写
- 危险命令黑名单（`rm -rf /`, `git push --force`, `DROP TABLE`）→ 二次确认
- 审计日志：所有操作记录到 `.icloser/audit.log`

### 3.8 AI Provider 适配层 (`src/ai/provider.ts`)

策略模式实现，统一接口 `AIProviderAdapter`：

| Provider | API 风格 | SDK 依赖 | 流式支持 |
|----------|---------|---------|---------|
| Claude | Anthropic Messages API | `@anthropic-ai/sdk` | ✓ |
| DeepSeek | OpenAI-compatible | `openai` SDK | ✓ |
| OpenAI | OpenAI Chat Completions | `openai` SDK | ✓ |
| Qwen | DashScope OpenAI-compatible | `openai` SDK | ✓ |
| Mock | 本地确定性输出 | 无 | ✓ |

**S1 离线验收 Provider：**
- `mock` provider 不调用网络、不需要 API Key。
- 它根据任务中的显式文件路径或 `ContextPackage.relevantCode` 的最高相关文件生成 S2 AI Output Contract JSON。
- 用途是验证 CLI task 主链：写文件、验证、报告、记忆、状态流转。
- 不用于评估真实 AI 代码质量。

### 3.8.1 AI Output Contract (`src/ai/output-contract.ts`)

任务主链消费统一结构化输出：

```json
{
  "summary": "本次修改摘要",
  "changes": [
    {
      "file": "src/example.ts",
      "operation": "write",
      "content": "完整文件内容",
      "reasoning": "为什么修改这个文件"
    }
  ]
}
```

- `operation` 当前仅支持 `write`。
- `file` 必须是项目内相对路径，拒绝绝对路径和 `..` 越界。
- `content` 必须是完整文件内容。
- legacy `write:路径` 代码块仍可解析，但只作为兼容路径。
- mock provider 输出同一结构，因此 `npm run smoke` 会覆盖协议解析和写入。

### 3.9 Agent 管理器 (`src/agent/manager.ts`)

Agent 抽象模型：
```
AgentInstance
├── id / name / type / status
├── context: ContextPackage（独立上下文）
├── tools: string[]（授权工具列表）
├── sandboxLevel: none | readonly | isolated
├── budget: { maxTokens, maxTime }
└── parentId / childIds（树状层级）
```

**通信机制：**
- 消息总线：`Map<string, AgentMessage[]>` agentId → messages
- 共享上下文池：`Map<string, Record<string, unknown>>` key → value
- 广播：按 AgentType 群发通知

**完整 API：**
```
AgentManager
├── create({name, type, model?, context?, tools?, parentId?, sandboxLevel?, budget?}) → AgentInstance
├── start(agentId, task?) → boolean       // 异步调用 AI Provider
├── pause(agentId) → boolean              // 暂停 + 取消 AI 调用
├── resume(agentId) → boolean             // 恢复执行
├── stop(agentId) → boolean               // 递归停止子 Agent
├── get(agentId) → AgentInstance?
├── list({status?, type?, parentId?}) → AgentInstance[]
├── activeCount() → number
├── sendMessage({from, to, content, type}) → AgentMessage
├── getMessages(agentId) → AgentMessage[]
├── broadcast(content, type?) → void
├── writeContext(key, value) → void
├── readContext(key) → Record?
├── clearContext() → void
├── createChildren(parentId, tasks[]) → AgentInstance[]
├── getTree(agentId) → hierarchy
└── updateAiConfig(config) → void
```

**安全沙箱（S14）：**
```
checkSandboxWrite(filePath, level, projectRoot) → { allowed, reason? }
filterSandboxedFiles(files[], level, projectRoot) → { allowed[], blocked[] }

级别：
  none     — 无限制
  readonly — 禁止所有文件写入
  isolated — 禁止访问项目根目录外的路径（含路径穿越检测）
```

**集成点：**
- CLI：`ic agent create/start/stop/list/status --json`
- REPL：`/run <描述>` `/agents` `/agent create/stop/status`
- Task：`ic t "任务" --go` 自动创建 Agent（S13）
- Report：任务报告包含 Agent 执行摘要（S15）

### 3.10 Skill 系统

Skill 功能已整合到 Agent 系统和 Task 引擎中，不再作为独立模块存在。

内置能力通过 Agent 模板提供：Code Reviewer、Test Runner、Code Explorer、Task Executor、Orchestrator。

重复任务模式检测由 `src/core/memory.ts` 的长期记忆系统处理。

### 3.11 门禁检查器 (`src/gate/checker.ts`)

六道门禁，按顺序执行：

1. **测试门禁** — 全绿 + 覆盖率达标
2. **安全门禁** — 无敏感文件修改 + 无硬编码密钥
3. **推理门禁** — 每个修改文件都有 intent/reasoning/impact
4. **报告门禁** — 必需字段齐全
5. **回滚门禁** — 回滚方案可执行
6. **Git 门禁** — 工作区清洁

## 四、数据流

### 4.1 任务执行完整数据流

```
ic t "描述"
  │
  ├─ 1. loadConfig()           → ICloserConfig
  ├─ 2. createTask()           → Task (status: queued)
  ├─ 3. assembleContext()      → ContextPackage（压缩后的上下文包）
  ├─ 4. generatePlan()         → TaskPlan（子目标 + 影响文件）
  ├─ 5. acquireFileLocks()     → 锁定冲突文件
  ├─ 6. AI Provider 调用        → AIResponse（修改方案/代码）
  ├─ 7. security.check()       → SecurityCheck（权限校验）
  ├─ 8. 写入文件                → 实际文件修改
  ├─ 9. runVerification()      → VerifyResult（3轮自动修复）
  ├─ 10. addReasoning()         → ChangeReasoning（修改推理链）
  ├─ 11. generateTaskReport()   → report.md
  ├─ 12. runGateCheck()         → GateResult（6道门禁）
  ├─ 13. recordTask()           → 写入任务记忆
  ├─ 14. proposeGlobalPatterns() → 生成长期知识候选（proposed）
  └─ 15. humanApproveMemory()   → 人类确认后写入 approved 长期知识
```

### 4.2 REPL 交互数据流

```
用户输入（自然语言/斜杠命令）
  │
  ├─ /command ──→ handleSlashCommand() ──→ 直接执行
  │
  └─ 自然语言 ──→ handleChat()
                  │
                  ├─ buildRichContext()    → 检索相关源码文件
                  ├─ buildSystemPrompt()   → 注入项目索引 + Skill 提示词
                  ├─ createProvider().chatStream() → 流式 AI 调用
                  ├─ extractFileBlocks()   → 解析 AI Output Contract（legacy write: 兜底）
                  └─ saveSession()         → 持久化对话状态
```

## 五、类型系统

核心类型定义在 `src/types.ts`（415行），按领域分组：

| 领域 | 核心类型 | 关键字段 |
|------|---------|---------|
| 项目身份 | `ProjectIdentity` | language, framework, database, buildSystem |
| 代码图谱 | `ProjectIndex` | modules, apis, database, dependencyGraph |
| 任务系统 | `Task` | status, plan, changes, reasoning, verifyResult |
| 验证 | `VerifyResult` | stages, overall, coverage, attempts |
| 门禁 | `GateResult` | checks, blocking, prDescription |
| 记忆 | `ProjectMemory`, `GlobalMemory` | rules, decisions, taskHistory, techStacks, reviewStatus, evidence |
| AI | `AIConfig`, `ContextPackage` | provider, model, projectMeta, relevantCode |
| Agent | `AgentInstance` | type, status, context, sandboxLevel |
| Skill | `Skill`, `SkillManifest` | triggers, requires, systemPrompt |

## 六、关键设计决策

1. **打分制优于布尔检测** — 项目识别使用多信号打分，避免单文件缺失导致误判
2. **文件锁优于事务** — 任务并发用文件锁而非 git worktree，降低复杂度
3. **分层压缩优于全量注入** — 上下文管理按相关性分数分级，最大化 Token 利用率
4. **策略模式适配 AI Provider** — 统一 `AIProviderAdapter` 接口，新增 Provider 只需实现 2 个方法
5. **零知识用户优先** — Agent OS 自动压缩、去重、评级和处理低风险记忆；全局长期知识不能静默 approved
6. **3 轮自动修复上限** — 防止 AI 陷入修复死循环，超限后保留现场给人工介入
7. **预览优先** — 所有任务默认预览模式，用户确认后才执行写入（`--go` 跳过）
8. **选择优先** — REPL 输入框承载用户选择而不是命令背诵；系统权限操作必须先展示中文确认面板，再由用户按数字执行

