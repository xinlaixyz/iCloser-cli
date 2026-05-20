# iCloser Agent Shell OS 
## Memory Kernel & Recall Runtime 集成工程 PRD
### Version: V1.0
### Status: 可工程落地

## 1. 项目背景

iCloser Agent Shell OS 在现有版本中已经具备 Shell Runtime、Task Engine、Code Patch Engine、Verify Engine、Security Sandbox、Project Workspace 和 CLI Runtime 等核心组件。但系统仍然属于“**无状态 AI 执行器**”：

- 每次任务都像第一次见面，没有持续记忆。
- 无法长期理解项目历史、用户偏好或工程规则。
- 无法沉淀历史 Bug 与经验。
- 无法自主遗忘噪音信息或通过时间轴回忆。

因此需要为 Agent Shell OS 引入 Memory Kernel，并在此基础上增加 Memory Runtime 和 Recall Engine，使其具备类人“认知能力”。

## 2. 项目目标

将 Agent Shell OS 从无状态执行器升级为能够持续学习与积累的“工程操作系统”。系统应具备以下能力：

- 长期项目记忆（情景记忆与语义记忆）。
- 工程规则与经验沉淀以及用户偏好理解。
- 任务历史认知与时间轴回忆能力。
- 主动遗忘噪音、强化重要事件的机制。
- 基于记忆的动态 Recall 与上下文编排能力。
- 在保证安全的前提下持续优化自身性能。

## 3. 总体架构

整个系统在原有的 Shell OS 之上新增 Memory Kernel 与 Memory Runtime 两大组件，实现如下结构：

```text
iCloser Agent Shell OS
├── Shell Runtime
├── Task Engine
├── Code Patch Engine
├── Verify Engine
├── Security Sandbox
├── Project Workspace
├── CLI Runtime
└── Memory Kernel
    ├── Sensory Buffer
    ├── Working Memory
    ├── Episodic Memory
    ├── Semantic Memory
    ├── Recall Engine
    ├── Consolidation Engine
    ├── Salience Engine
    └── Forgetting Engine
```

Memory Runtime & Recall Engine 则作为认知调度层，负责记忆检索、上下文拼接和写入更新：

```text
User Task
↓
Memory Runtime
↓
Recall Pipeline
↓
Context Composer
↓
Working Memory
↓
LLM Runtime
↓
Task Execution
↓
Memory Update
```

## 4. Memory Kernel 设计

### 4.1 感官记忆层（Sensory Buffer）

- **数据来源**：CLI 输入、Shell 输出、Git Diff、编译日志、Docker 输出、测试结果、文件变化与安全日志。
- **存储方式**：采用 JSONL 格式的 FIFO 队列，短暂存储于内存或快速缓存。
- **生命周期**：保留时间 5–60 秒，低价值信息在短时间内自动删除。

### 4.2 工作记忆层（Working Memory）

- **职责**：保存当前任务状态、推理过程、上下文、错误信息、当前 diff 以及 Recall 回来的背景知识。 
- **建议大小**：16k–32k tokens，动态更新，任务结束后会固化到长期记忆或丢弃。

### 4.3 长期记忆层（Long-Term Memory）

长期记忆分为两类：

1. **情景记忆（Episodic Memory）** – 记录具体事件的时间、任务、修改内容等。例如：2026-05-19 用户要求修改钱包首页 DID 为 Swap。存储可以使用 SQLite、JSONL 或 Markdown Journal。
2. **语义记忆（Semantic Memory）** – 抽象出工程规则、用户偏好和架构约束。例如：iCloser iOS UI 的修改规则——不要新增 API、不要修改绑定，只能修改 UI 和文案。可以用 Markdown 树、JSON 图或者 SQLite 索引方式存储。

### 4.4 Consolidation Engine

- 定期读取最近的情景事件，压缩为摘要。
- 从摘要中抽象出语义规则，更新语义记忆库。

### 4.5 Salience Engine

- 为记忆赋予情绪/重要度权重。高权重关键词包括“严重”、“紧急”、“立刻”、“生产事故”。重要事件优先固化和 Recall。

### 4.6 Forgetting Engine

- 根据遗忘公式 M(t) = M0 × e^(-t/S)，对低权重记忆进行衰减和淘汰。
- 支持主动清理低价值、过期或噪音信息，保证长期记忆可管理。

### 4.7 Recall Engine（Memory Kernel 层）

- 提供基础的时间、逻辑与情绪 Recall 功能。
- 按照 Top-K 规则返回最相关的记忆条目供 Runtime 使用。

## 5. Memory Runtime & Recall Engine 设计

与 Memory Kernel 相配套的 Memory Runtime 负责动态调度 Recall 和上下文编排，使 LLM 在推理过程中能够参考长期记忆而不会引起上下文爆炸。

### 5.1 Memory Runtime 定义

Memory Runtime 是整个 Agent Shell OS 的认知调度器，主要负责：

- 决定何时执行 Recall，以及 Recall 的策略和数量。
- 控制上下文规模，避免 Token 爆炸、Recall 污染和低价值注入。
- 管理 Working Memory 的生命周期，动态刷新、清理与固化。
- 在任务结束后触发长期记忆更新（Episodic & Semantic）。

### 5.2 Recall Pipeline

Recall Pipeline 是 Memory 检索流水线，工作流程如下：

1. **任务解析（Task Parsing）** – 将用户命令解析为结构化的 Recall 查询。例如 `agent task "修改钱包首页 Swap UI"` 解析为 JSON：
   ```json
   {
     "module": "wallet",
     "platform": "ios",
     "action": "ui modification",
     "keywords": ["swap", "wallet", "ui"]
   }
   ```
2. **构建 Recall Query** – 根据解析结果生成 timeline、semantic、emotion 等检索关键词。
3. **执行 Recall** – 先进行 Timeline Recall、再进行 Semantic Recall，必要时加入 Emotion Recall。
4. **Recall 排序** – 由 Recall Ranking Engine 根据相关度、时间、情绪权重等计算 Recall Score，选取 Top K（默认 5 个）结果。
5. **上下文编排** – Context Composer 将 Recall 结果按相关性排序、压缩摘要，并注入到 Working Memory。
6. **任务执行** – LLM Runtime 使用新的 Working Memory 进行推理和代码执行。
7. **记忆更新** – 任务完成后，系统根据执行结果生成情景事件，并抽象出新的语义规则，更新长期记忆库。

### 5.3 Recall 类型

1. **Timeline Recall** – 依据时间线检索，如“上个月、部署前、回滚后、昨天”。检索来源为情景记忆的时间轴。
2. **Semantic Recall** – 依据逻辑关键词检索，如“Wallet、AML、Swap、iOS UI”。检索来源为语义记忆树。
3. **Emotion Recall** – 强化高风险/高影响事件的检索，如“严重事故、生产故障、紧急 Bug”。系统对这类事件赋予高权重，优先 Recall。

### 5.4 Recall Ranking Engine

Recall Ranking Engine 是决定唤醒哪些记忆的核心，计算公式：

```
Recall Score = Semantic Similarity + Timeline Relevance + Emotional Weight + Recent Usage + Task Similarity
```

排序因素包括任务关键词相似度、时间接近度、情绪权重、最近被使用情况以及历史任务的相似性。
系统默认只返回 Top 5 记忆项，禁止全量注入，以防上下文爆炸。

### 5.5 Context Composer

Context Composer 动态编排上下文，流程包括：

- **Context Ranking** – 依据 Recall Ranking Engine 的得分进行排序。
- **Context Compression** – 压缩低优先级内容，保留关键信息。
- **Context Injection** – 将最终选择的记忆片段与当前任务描述拼接注入到 Working Memory。注入内容应精简、精准、高相关。

示例注入内容：

```
Current Task:
修改钱包首页 Swap UI

Relevant Rules:
- 不要新增 API
- 不要修改绑定

Historical Failures:
- 上次 wallet UI 修改导致崩溃
```

### 5.6 Working Memory 注入原则

Working Memory 必须保持小而精，不允许 LLM 直接读取完整的长期记忆。系统通过 Runtime 调度器控制注入内容的规模和相关性，确保推理稳定。

### 5.7 Memory Update Pipeline

任务执行完毕后：

1. 生成情景事件，记录任务、diff、测试结果、部署与回滚情况等。
2. 调用 Consolidation Engine 压缩摘要，抽象出语义规则（工程规则、用户偏好、架构约束等）。
3. 更新长期记忆，并重新计算记忆重要度。

### 5.8 Context Explosion Protection

为防止上下文爆炸、污染和漂移，系统应实现：

- Recall 数量限制：默认 Top 5。
- Working Memory Token Budget：最大 32k tokens。
- Context 压缩：低优先级内容自动摘要或丢弃。

## 6. 与现有 Shell 系统集成

### 6.1 Task Engine 集成

在执行 `agent task` 时，系统会自动：

- 调用 Memory Runtime 解析任务并构建 Recall 查询。
- 从 Memory Kernel 中 Recall 相关规则、历史失败、用户偏好和架构约束。
- 注入 Working Memory，提供给 LLM Runtime 进行推理。
- 任务执行完成后更新记忆库。

### 6.2 CLI 命令设计

新增一组 `agent memory` 命令供用户监控和调试记忆系统：

```bash
agent memory status             # 查看 Memory 系统状态
agent memory recall "wallet ui rules" # 手动查询相关记忆
agent memory consolidate        # 手动触发记忆固化
agent memory archive            # 归档长久未用的记忆
agent memory inspect task_001   # 查看指定任务的记忆
agent memory forget --low-score # 清理低分记忆

agent memory runtime-status     # 查看 Runtime 状态
agent memory inspect working    # 查看当前 Working Memory
agent memory inspect episodic   # 查看情景记忆库
agent memory inspect semantic   # 查看语义记忆库
```

执行 `agent task "修改钱包 UI"` 时，系统会自动触发 Recall，并将相关规则和历史信息注入到当前任务的 Working Memory 中。

## 7. 存储目录结构

建议在项目根目录下建立 `.agent/memory/` 结构，用于存储各类记忆文件：

```text
.agent/
├── memory/
│   ├── sensory/       # 感官记忆缓冲区
│   ├── working/       # 当前工作记忆快照
│   ├── long-term/
│   │   ├── episodic/  # 情景记忆
│   │   ├── semantic/  # 语义记忆
│   │   └── index.sqlite # 全局索引
│   ├── archive/       # 已归档记忆
│   └── policies/      # 记忆策略与规则
├── tasks/
├── reports/
├── diffs/
└── logs/
```

## 8. 技术栈与实现建议

- **操作系统**：Linux
- **语言**：Python（方便处理文本、调用 LLM、操作 SQLite）
- **存储**：SQLite（结构化索引）、Markdown/JSONL（易于 diff 和版本控制）
- **检索算法**：简单向量嵌入配合 BM25 或密集检索库实现 Recall Ranking；首版禁止使用分布式向量数据库（如 Milvus、Pinecone）
- **并发**：采用异步任务（Async Workers）实现 Recall 与 Consolidation

首版不考虑引入复杂微服务或分布式存储，以保证部署简单且便于控制。

## 9. MVP 范围

第一版（V1.0）必须完成：

1. 感官记忆、工作记忆、情景记忆和语义记忆的基本存储与管理。
2. Recall Pipeline，包括任务解析、Recall 排序（Top-K）和上下文注入。
3. Consolidation Engine（记忆固化）与 Forgetting Engine（主动遗忘）的基本实现。
4. Memory Runtime 对 Recall 调度、上下文控制和 Working Memory 管理的基本功能。
5. 更新长期记忆的自动流程（情景事件记录与语义规则提取）。
6. 新增 CLI 命令集让用户管理 Memory。
7. 实现 Context Explosion 保护策略（Token Budget、Recall 限制、压缩规则）。

## 10. 验收标准

系统验收时应满足：

- **Recall 成功率**：在执行相关任务时能够正确唤醒历史规则与失败经验。
- **上下文稳定性**：Working Memory 不发生 Token 爆炸，内容紧凑且相关。
- **语义学习**：系统能抽象出长期工程规则，并在后续任务中生效。
- **Recall 排序正确**：高价值记忆优先被注入，低价值记忆被压缩或淘汰。
- **系统稳定性**：Memory Runtime 能在 Linux 环境下长期稳定运行，不影响 Shell OS 的任务执行。

## 11. 最终愿景

通过 Memory Kernel 和 Memory Runtime 的引入，iCloser Agent Shell OS 将不再是一个无状态的 AI 执行器，而是逐渐成长为一名长期合作的高级工程师：

- 理解项目历史、架构和团队习惯。
- 记住过去的错误与教训，避免重复踩坑。
- 主动提醒不可修改的敏感代码或参数。
- 在重要或紧急任务中优先 Recall 高风险经验，减少生产事故。
- 支持中文输入/输出，适配中国团队的开发和沟通方式。

这样的系统将极大提升团队效率与软件质量，让 AI 真正成为工程团队的伙伴而不是孤立的工具。
