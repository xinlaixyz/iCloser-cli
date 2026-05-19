# Memory Kernel & Recall Runtime — 完整文档

版本: 1.0 | 日期: 2026-05-19 | 状态: **已完全激活**

---

## 概述

Memory Kernel 是 iCloser Agent Shell 的认知记忆核心，将系统从"无状态 AI 执行器"升级为"持续学习的工程操作系统"。它自动记录用户交互、项目变更、错误经验，在每次 AI 调用前检索相关记忆并注入上下文，使 AI 具备类人的"项目记忆"能力。

**核心能力:**
- 自动从 git 历史导入情景记忆（无需手动配置）
- 自动从代码库配置提取语义规则（TS strict/ESLint/Vitest/Docker）
- 每次 AI 对话前自动 Recall 相关记忆注入上下文
- 每 5 次任务自动固化新规则
- 遗忘曲线自动淘汰低价值记忆

---

## 架构

```
Memory Kernel
├── Sensory Buffer       FIFO 感官缓冲 (5-60s TTL, 低价值过滤)
├── Working Memory       16k-32k token 工作记忆 (分层结构)
├── Episodic Memory      情景事件日志 (JSONL+SQLite, 时间轴查询)
├── Semantic Memory      语义规则树 (规则库+置信度+来源追溯)
│
├── Salience Engine      重要度评分 (关键词加权+反馈+重复+时间衰减)
├── Forgetting Engine    遗忘引擎 M(t)=M0×e^(-t/S) 分级半衰期
├── Consolidation Engine 记忆固化 (情景→摘要→语义规则)
│
├── Recall Engine        检索流水线 (Timeline+Semantic+Emotion → Ranking → Top-K)
├── Memory Runtime       认知调度器 (任务生命周期钩子)
└── Context Composer     上下文编排 (排序+压缩+注入+防爆炸)
```

---

## 产品功能

### 自动激活 (Zero-Config)

```
ic init  → 自动 bootstrap:
  1. git log → 情景事件 (最近 50 条 commit)
  2. tsconfig/eslint/vitest/docker 检测 → 语义规则
  3. 跨 commit 模式检测 → 初始固化

状态: ● 已激活
```

### 自动运行 (Fire-and-Forget)

每次 AI 对话:
```
用户输入 → 感官缓冲
  → Recall 检索 (历史+规则+重要事件)
  → Context Composer 注入 Top 12 (最多 20 条, 6K tokens)
  → AI 收到增强上下文
  → 对话结束 → 记录情景事件
  → 每 5 次任务 → 自动固化规则
```

### CLI 命令

| 命令 | 描述 |
|------|------|
| `ic mem status` | Memory Kernel 运行时状态 (存储/Recall/固化/工作记忆) |
| `ic mem recall <查询>` | 手动检索相关记忆，显示 Top 12 结果及分数 |
| `ic mem recall "修改钱包 UI"` | 关键词检索 (分词匹配) |
| `ic mem bootstrap` | 从 git + 代码配置重新引导记忆 |
| `ic mem consolidate` | 手动触发记忆固化 |
| `ic mem forget` | 清理低分/过期记忆 |
| `ic mem inspect working` | 查看当前工作记忆内容 |
| `ic mem inspect semantic` | 查看语义规则树 |
| `ic mem inspect episodic` | 查看情景记忆 (近 30 天) |
| `ic mem rule add <规则>` | 手动添加语义规则 |
| `ic mem rule list` | 列出所有规则 |
| `ic mem rule delete <id>` | 删除规则 |
| `ic mem stats` | 记忆统计 (事件数/规则数/DB 大小) |

### 调试

```bash
# 查看详细日志 (Recall 追踪、初始化流程)
ICLOSER_MEMORY_DEBUG=info ic mem status

# 仅错误和警告
ICLOSER_MEMORY_DEBUG=warn ic mem status
```

---

## 开发者文档

### 目录结构

```
src/core/memory/
├── store.ts            # 存储工厂 (.agent/memory/ 目录初始化)
├── sqlite-store.ts     # SQLite 索引 (node:sqlite, episodic+semantic 表)
├── jsonl-store.ts      # JSONL 追加/读取/轮转
├── sensory-buffer.ts   # 感官缓冲区 (FIFO + 噪声过滤)
├── working-memory.ts   # 工作记忆 (16k-32k token 管理)
├── episodic.ts         # 情景记忆 (事件 CRUD + 时间轴查询)
├── semantic.ts         # 语义规则 (规则树 + 置信度 + 分词搜索)
├── salience.ts         # 重要度评分引擎
├── forgetting.ts       # 遗忘引擎 M(t)=M0×e^(-t/S)
├── consolidation.ts    # 记忆固化 (情景→摘要→规则)
├── recall.ts           # Recall 检索流水线 (Task Parsing → 3 种 Recall → Ranking)
├── runtime.ts          # 认知调度器 (生命周期钩子)
├── composer.ts         # 上下文编排器 (排序+压缩+注入)
├── bootstrap.ts        # 自动引导 (git 历史 + 代码模式)
├── integration.ts      # 集成适配器 (REPL/TaskEngine/Context 钩子)
├── cli-handlers.ts     # CLI 命令处理函数
└── debug.ts            # 调试日志器
```

### 关键接口

```typescript
// 获取 Memory Runtime 单例
import { getMemoryRuntime } from './core/memory/integration.js';
const runtime = await getMemoryRuntime(rootPath);

// 任务生命周期钩子
await runtime.onTaskStart(taskId, description);
await runtime.onTaskComplete(taskId, { filesChanged, verifyPassed, summary });
await runtime.onTaskError(taskId, error);

// 手动 Recall
const results = await runtime.recall.recall('修改钱包 UI');
// → RecallResult[] [{ type, source, content, score, raw }]

// 上下文注入
import { getMemoryContextForLLM } from './core/memory/integration.js';
const memoryContext = await getMemoryContextForLLM(rootPath, taskDescription);

// Bootstrap
import { bootstrapMemoryKernel } from './core/memory/bootstrap.js';
const result = await bootstrapMemoryKernel(rootPath, runtime);
// → { gitCommits, episodesCreated, rulesCreated, patternsFound, errors }
```

### 新增存储

```
.agent/memory/
├── sensory/                      # 感官缓冲 JSONL
├── working/                      # 工作记忆快照
├── long-term/
│   ├── episodic/                 # 情景事件 {YYYY-MM}.jsonl
│   ├── semantic/
│   │   ├── rules.json            # 语义规则库
│   │   └── tree.md               # 规则树（人类可读）
│   └── index.sqlite              # 结构化索引
├── archive/                      # 已归档记忆
└── policies/                     # 固化/遗忘日志
```

### 数据流

```
ic init / ic mem bootstrap
  → seedFromGitHistory()       git log -50 → 情景事件
  → seedFromCodePatterns()     检测 tsconfig/eslint/vitest/docker → 语义规则
  → runConsolidation()         跨事件模式 → 新规则

每次 AI 调用:
  → ingestUserInput()          用户输入 → 感官缓冲
  → onTaskCreated()            初始化 WM + 触发 Recall → 注入上下文
  → buildRichContext()         assembleContextFromProject()
  → getMemoryContextForLLM()   Recall → ContextComposer → 注入
  → AI 收到 [记忆: 规则+历史+偏好]
  → onTaskCompleted()          记录情景事件 + 每5次触发固化

ic mem forget:
  → ForgettingEngine.cleanup() M(t)<0.05 → 归档, M(t)<0.01 → 删除
```

### 测试

```
tests/memory/
├── storage.test.ts          JSONL + MemoryStore path 测试
├── sensory-wm.test.ts       SensoryBuffer + WorkingMemory 测试
├── salience-forget.test.ts  Salience + Forgetting Engine 测试
└── recall-composer.test.ts  Recall Pipeline + ContextComposer 测试

63 tests / 0 failures
```

---

## Recall 评分公式

```
RecallScore = 0.25 × SemanticSimilarity  (关键词匹配度)
            + 0.20 × TimelineRelevance    (时间接近度)
            + 0.25 × EmotionalWeight      (情绪/重要度)
            + 0.15 × RecentUsage          (最近访问)
            + 0.15 × TaskSimilarity       (任务相似度)

Top-K = 12 (默认), 注入 Token ≤ 6000 (2026-05-20 提升)
```

## 遗忘公式

```
M(t) = M0 × e^(-t/S)

M0: 初始重要度 (high=0.85, medium=0.55, low=0.3)
S:  半衰期 (high=90d, medium=30d, low=7d)
t:  距今时间 (天)

M(t) < 0.05 → 归档
M(t) < 0.01 → 删除
保护: 永久规则 / 近期引用 / 关联活跃任务
```
