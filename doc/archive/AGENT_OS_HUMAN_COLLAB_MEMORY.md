# Agent OS 上下人处理模式与可审计记忆系统

## 1. 核心理念

iCloser Agent Shell 的长期目标不是只做一个“会改代码的 CLI”，而是成为一个带人类治理边界的 Agent OS。核心模式是：

> 上层人类表达目标 + 下层 Agent 自动执行治理 + 分层记忆闭环 + 可审计反馈

这套模式要求人类始终保留最终控制权，但不能把复杂审核责任丢给用户。用户只需要表达目标、在少数高风险节点做简单选择；Agent OS 负责自动记录、自动分类、自动压缩、自动去重、自动判断风险，并给出默认处理。

## 1.1 零知识用户原则

产品必须面对完全不懂 Agent、记忆、Provider、审计和工程术语的用户仍然可用。

**默认原则：**
- 用户只管输入目标，不负责理解系统内部机制。
- 系统不能要求用户逐条审核原始记忆。
- 系统不能把“是否应该沉淀为长期知识”这种判断原样抛给用户。
- 系统先自动分类、压缩、去重、判风险，再只把少量必要问题变成选择题。
- 每个打断都必须有推荐选项，并说明“不懂就选这个”。
- 可逆、低风险、局部范围内的记忆处理默认自动完成。
- 不可逆、高风险、跨项目/全局影响、涉及安全/权限/支付/数据库/部署的内容才需要用户确认。

## 2. 角色分层

| 层级 | 角色 | 主要职责 | 关键边界 |
|------|------|----------|----------|
| 上层 | Human | 表达目标、确认少数高风险动作、修正系统误解 | 不需要理解技术细节，拥有最终否决权 |
| 下层 | Agent OS | 任务拆解、执行、信息收集、记忆记录、自动压缩、自动风险判断 | 可自动处理低风险记忆，不可静默执行高风险全局沉淀 |
| 外部 | Tool / API | 数据查询、自动化操作 | 默认受限，必须进入审计日志 |

## 3. 记忆分层

| 层级 | 角色 | 功能 | 生命周期 | iCloser 落点 |
|------|------|------|----------|--------------|
| 短期记忆 | Agent | 会话上下文、即时执行结果、所有用户输入、Agent 输出 | 会话结束或任务完成后归档/丢弃 | REPL session、Task runtime |
| 任务记忆 | Agent + Human | 项目进度、任务状态、执行日志、验证结果 | 持续更新，任务完成后归档 | `.icloser/tasks/<task-id>/`、`.icloser/memory.json` |
| 长期知识库 | Auto-reviewed + Human-confirmed | 历史经验、流程模板、策略规则、跨项目模式 | 自动评级后持续累积；全局/高风险需确认 | `~/.icloser/global-memory/` |
| 外部知识接口 | Agent | API / 数据源调用 | 实时查询，默认不持久化 | Provider、搜索、工具调用 |

## 4. 记忆元数据要求

每条可持久化记忆必须具备：

- `id`：唯一 ID
- `scope`：short-term / task / long-term / external
- `source`：用户输入、Agent 输出、验证日志、外部接口等
- `taskId`：关联任务
- `agentId`：执行或提出该记忆的 Agent
- `createdAt` / `updatedAt`
- `reviewStatus`：draft / proposed / approved / rejected / archived
- `version`：记忆版本
- `evidence`：可追溯证据，如文件路径、报告路径、命令输出摘要

## 4.1 用户输入记忆要求

用户输入是记忆系统的一等数据源。所有来自人类的输入都必须进入短期记忆原始日志，包括：

- 自然语言任务描述
- REPL 普通消息
- 斜杠命令和命令参数
- 对 Agent 输出的确认、拒绝、修改意见
- 对文件写入、长期记忆、模板沉淀的审批动作
- 中途追加的约束、偏好、规则和纠错

归档规则：

- 原始输入先进入短期记忆，保留输入时间、会话 ID、任务 ID、用户角色和来源入口。
- 与具体任务相关的输入，在任务结束时归档到任务记忆。
- 可复用的约束、偏好、流程经验，先由系统自动压缩、去重、评级。
- 低风险项目内偏好可自动进入项目记忆；中高风险或跨项目内容进入长期知识候选 `proposed`。
- API Key、密钥、token、隐私数据等敏感输入必须脱敏保存，或只保存“发生过配置动作”的审计摘要。
- 用户明确要求“不记住/不要沉淀”的内容，只进入必要审计日志，不进入长期候选。

## 4.2 自动审核与自动压缩

记忆系统默认自动审核大部分内容，避免用户被记忆候选淹没。

| 内容类型 | 默认处理 |
|----------|----------|
| 原始用户输入 | 自动进入短期记忆事件流 |
| 任务相关输入、执行日志、验证结果 | 自动归档到任务记忆 |
| 重复事实、低风险局部偏好 | 自动压缩并合并到项目记忆 |
| 用户明确说“记住 / 以后都 / 规则是” | 自动生成候选，按风险决定是否打断 |
| 项目内低风险规则 | 可自动 approved，并保留回滚入口 |
| 跨项目/全局规则 | 默认 proposed，等待用户在合适时机批量确认 |
| 安全、权限、数据库、部署、支付相关规则 | 必须确认，但用简单选择题呈现 |
| API Key、密钥、隐私内容 | 永不长期保存明文，只保留脱敏审计 |

压缩链路：

```text
原始输入事件
  → 会话摘要
  → 任务摘要
  → 项目规则 / 偏好 / 流程模板
  → 长期知识候选
```

压缩后的记忆必须保留 `sourceEventIds`、`taskId`、`sessionId`、`compressionLevel`、`reviewStatus` 和 `evidence`，保证可追溯。

## 4.3 用户打断策略

系统只有在必要时才打断用户。所有问题必须是低认知负担选择题。

推荐格式：

```text
我发现一个可能长期有用的规则：

登录相关任务不要直接修改数据库 schema

推荐：保存到当前项目

[1] 保存到当前项目（推荐）
[2] 只本次使用
[3] 不保存
[4] 我来改一下
直接回车 = 选择推荐
```

禁止出现需要普通用户理解的提问，例如：

```text
是否将该 MemoryCandidate 写入 GlobalMemory approved scope？
```

## 5. 人机协同流程

```text
Human Task Input
  │
  ▼
Agent OS: Task Parsing & Decomposition
  │
  ▼
Subtasks Assigned to Agents ──> Short-term Memory Logging
  │
  ▼
Execution & Data Collection ──> Task Memory Update
  │
  ▼
Automatic Review / Compression
  ├─ Low Risk → Auto Archive / Auto Approve Project Memory
  ├─ Medium Risk → Batch Candidate, Ask Later
  └─ High Risk → Simple Human Choice
  │
  ▼
Archival / Template Extraction ──> Long-term Memory
```

## 6. 与当前系统的映射

| 需求 | 当前状态 | 后续任务 |
|------|----------|----------|
| 短期记忆 | REPL conversation 已存在 | 增加 session 摘要归档 |
| 任务记忆 | task report / reasoning / verify.log 已存在 | 统一写入 task memory metadata |
| 长期知识库 | global-memory 基础结构已存在 | 增加自动评级、批量审核、proposed/approved 流 |
| 审计 | security audit 基础设计已存在 | 统一记录 Agent 动作和工具调用 |
| 人类审批 | 文件写入已有 preview/execute 边界 | 增加 memory approval 和 template extraction |
| 多 Agent | manager 骨架存在 | 接入任务拆解、子任务记录和共享上下文 |

## 7. 实施优先级

### S4.1 Memory Metadata Unification

统一短期、任务、长期记忆的元数据字段，补齐 `source`、`taskId`、`agentId`、`reviewStatus`、`version`、`evidence`，并确保所有用户输入都被记录为可追溯事件。

### S4.2 Automatic Memory Review for Zero-Knowledge Users

Agent 完成任务后自动分类、压缩、去重、评级。低风险项目记忆自动归档；中风险候选批量待确认；高风险内容用简单选择题即时确认。新增命令用于查看、批准、拒绝候选记忆，但普通用户不必须使用。

### S4.3 Task Archive and Template Extraction

任务完成后，从报告、验证日志、用户反馈中提取可复用模板。模板默认进入 proposed 状态，等待人类确认。

### S4.4 Agent Action Audit Log

将 Agent 的任务拆解、工具调用、文件读写、验证命令、记忆更新记录成统一审计流。

## 8. 验收标准

- 每个任务完成后可以追溯：谁触发、哪个 Agent 执行、改了什么、验证结果是什么、沉淀了什么记忆
- 每条用户输入都可以在短期或任务记忆中追溯，敏感输入必须脱敏
- 低风险记忆可自动归档，中高风险记忆必须有风险评级和默认建议
- 全局长期知识不能静默 approved；必须来自明确用户确认或团队策略配置
- 用户拒绝或修改记忆候选时，保留原始候选和修正版本
- 普通用户无需运行 `ic memory` 也能完成主路径；高级用户可用 `ic memory` 区分 project / global / proposed / approved
- 任务报告展示系统自动处理了哪些记忆、哪些候选等待确认
