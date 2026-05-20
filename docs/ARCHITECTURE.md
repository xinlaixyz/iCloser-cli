# AgentCode -- 架构设计文档

## 架构概览

项目 AgentCode 采用分层 + 模块化架构组织代码。技术栈为 TypeScript。
系统分为以下核心层次：

- **CLI 层** (`src/cli/`): 命令解析、终端 UI、REPL 交互、输出格式化
- **核心服务层** (`src/core/`): 扫描器、任务引擎、验证器、上下文组装、审计、安全
- **Memory Kernel** (`src/core/memory/`): 感官缓冲/工作记忆/情景记忆/语义记忆/Recall检索/固化/遗忘
- **Agent 管理层** (`src/agent/`): 多 Agent 生命周期管理、通信、编排
- **AI 集成层** (`src/ai/`): 多 Provider 抽象（Claude/DeepSeek/OpenAI/Qwen）、输出协议解析
- **门禁层** (`src/gate/`): 质量门禁检查
- **报告层** (`src/report/`): 任务报告、diff、验证日志生成
- **工具层** (`src/utils/`): Git、文件系统、项目检测工具
- **Skill 系统** (`src/skill/`): 技能插件管理
- **配置层** (`src/config.ts`): 项目配置读写

## 技术决策

- 语言选择：TypeScript (Node.js >= 18, ES2022)
- 框架：无框架，vanilla 方案
- 构建系统：npm (tsc 编译)
- 测试框架：vitest (112 个测试文件, 1640 passed / 2 skipped, 0 失败)
- 运行时兼容：Windows / macOS / Linux
- AI Provider：支持 Claude、DeepSeek、OpenAI、Qwen 及离线 mock

## 模块划分

当前项目包含 42 个源码文件，按功能分布在以下模块中：

| 模块 | 目录 | 职责 |
|------|------|------|
| cli | `src/cli/` | CLI 命令路由、终端 UI 渲染、REPL 交互循环、JSON 输出、循环面板 |
| core | `src/core/` | 核心引擎：扫描、任务、验证、上下文、审计、自动文档/测试 |
| agent | `src/agent/` | Agent 管理器、沙箱、模板、Agent 间通信 |
| ai | `src/ai/` | AI Provider 适配器、输出协议契约、错误分类 |
| gate | `src/gate/` | 质量门禁检查（测试、安全、推理、报告、回滚、Git） |
| report | `src/report/` | 任务报告、diff 文件、推理记录、验证日志生成 |
| skill | `src/skill/` | Skill 插件注册、管理和执行 |
| utils | `src/utils/` | Git 操作、文件系统工具、项目语言/框架检测 |

## 目录结构

```
AgentCode/
├── src/
│   ├── index.ts              (CLI 入口，所有命令注册)
│   ├── config.ts             (配置读写)
│   ├── types.ts              (全局类型定义)
│   ├── cli/                  (终端交互层)
│   │   ├── output.ts         输出格式化
│   │   ├── format.ts         验证/门禁排版
│   │   ├── json.ts            JSON 信封
│   │   ├── theme.ts          主题
│   │   ├── repl.ts           REPL 循环
│   │   ├── tui.ts            TUI 渲染
│   │   ├── choice-panel.ts   选择面板
│   │   ├── loop-panel.ts     循环面板
│   │   ├── system-runner.ts  系统命令执行
│   │   └── system-approval.ts 系统审批
│   ├── core/
│   │   ├── scanner.ts        项目扫描 + AST 解析
│   │   ├── task-engine.ts    任务创建/调度/执行
│   │   ├── task-loop.ts      三步循环状态机
│   │   ├── verifier.ts       编译/测试/lint 验证
│   │   ├── context.ts        上下文组装
│   │   ├── memory.ts         记忆系统 (已升级为 Memory Kernel)
│   │   ├── memory/             **Memory Kernel v1.0** ── 认知记忆核心
│   │   │   ├── store.ts          存储工厂
│   │   │   ├── sqlite-store.ts   SQLite 索引
│   │   │   ├── sensory-buffer.ts 感官缓冲
│   │   │   ├── working-memory.ts 工作记忆
│   │   │   ├── episodic.ts      情景记忆
│   │   │   ├── semantic.ts      语义记忆
│   │   │   ├── salience.ts      重要度引擎
│   │   │   ├── forgetting.ts    遗忘引擎
│   │   │   ├── consolidation.ts 记忆固化
│   │   │   ├── recall.ts        Recall 检索
│   │   │   ├── runtime.ts       认知调度器
│   │   │   ├── composer.ts      上下文编排
│   │   │   ├── bootstrap.ts     自动引导
│   │   │   ├── integration.ts   系统集成
│   │   │   └── debug.ts         调试日志
│   │   ├── audit.ts          审计日志
│   │   ├── security.ts       安全规则
│   │   ├── autopilot.ts      自动分析
│   │   ├── autodoc.ts        自动文档生成
│   │   ├── autotest.ts       自动测试生成
│   │   ├── autopilot-verify.ts  自动验证
│   │   ├── autopilot-repair.ts  自动修复
│   │   ├── autopilot-router.ts  自动路由
│   │   ├── autopilot-rollback.ts 自动回滚（快照/试运行/列表）
│   │   ├── execution-chain.ts   执行链
│   │   ├── tool-registry.ts     工具注册表
│   │   ├── tool-executor.ts     工具执行
│   │   ├── web-search.ts        网络搜索
│   │   ├── ast-parser.ts        AST 解析器
│   │   └── scanner-worker.ts    扫描工作线程
│   ├── agent/
│   │   └── manager.ts        Agent 管理
│   ├── ai/
│   │   ├── provider.ts       AI Provider 抽象层
│   │   ├── errors.ts         AI 错误分类
│   │   └── output-contract.ts AI 输出协议
│   ├── gate/
│   │   └── checker.ts        门禁检查器
│   ├── report/
│   │   └── generator.ts      报告生成
│   ├── skill/
│   │   └── manager.ts        Skill 管理器
│   └── utils/
│       ├── fs.ts             文件系统工具
│       ├── git.ts             Git 操作
│       └── detect.ts         项目检测
├── tests/
│   └── (51 个测试文件)
├── scripts/
│   └── (18 个 smoke/辅助脚本)
└── docs/
    └── (文档文件)
```

## 数据流

### 核心执行流程

```
用户输入 (CLI/REPL)
    │
    ▼
src/index.ts — commander 命令路由
    │
    ├── ic init → detectProject() → scanProject() → 保存配置与索引
    ├── ic scan → scanProject() → 保存索引
    ├── ic t    → createTask() → generatePlan() → executeTask()
    │                │
    │                ├── assembleContextFromProject()  [上下文组装]
    │                ├── AgentManager.create()         [创建 Agent]
    │                ├── provider.chat()               [AI 调用 + 工具循环]
    │                ├── 写入文件变更
    │                ├── runVerification()              [自动验证]
    │                ├── 自动修复循环
    │                └── 生成报告 & 更新记忆
    ├── ic gate  → runGateCheck()                     [质量门禁]
    └── ic auto  → autopilot 文档/测试生成
```

### Agent 执行流

```
AgentManager.create() → AgentInstance (状态: idle)
    │
    ▼
AgentManager.start() → 状态: running
    │
    ├── 构建 System Prompt (根据 Agent type)
    ├── provider.chat() — 实际 AI 调用
    ├── 解析输出结果
    └── 状态: done 或 failed
    │
    ▼
AgentManager.orchestrate() 支持编排模式:
    父 Agent (orchestrator) → 拆解子任务 → 创建子 Agent → 并行执行 → 汇总结果
```

### 扫描增量流

```
scanProject()
    │
    ├── detectProject()     — 语言/框架检测 (13 种编程语言 + 6 种非代码分类)
    │       │
    │       ├── 代码语言: ts/js/go/rust/python/java/kotlin/csharp/php/ruby/swift/objc/c/cpp
    │       └── 非代码: documentation/config/data/infrastructure/empty/unknown
    │
    ├── classifyProjectType() — 无代码文件时按文件组成分类 (文档/配置/数据/IaC)
    ├── detectSubprojects() — 深度 2 子目录扫描 monorepo 子项目
    ├── findFiles()         — 文件发现
    ├── filterBySize()      — 按尺寸/文本过滤 (并行)
    ├── computeFingerprints — 比对 mtime+size 指纹
    │       └── 未变更文件跳过重新解析
    ├── extractModules()    — 模块提取 (增量合并)
    ├── extractApiEndpoints — API 端点检测
    └── 构建依赖图 + 调用图
```

### 上下文注入流 (2026-05-19 更新)

```
buildRichContext(input)
    │
    ├── isAnalysisIntent? → maxTokens: 80K (非分析: 24K)
    │                    → deep: true (AST/调用图/架构检测)
    │                    → includeTests: true
    │
    ├── assembleContextFromProject(rootPath, task, options)
    │       ├── loadProjectIndex() — 已有索引直接使用
    │       └── scanProject(deep)  — 无索引时自动扫描
    │
    ├── assembleContext()
    │       ├── assembleProjectMeta()     — 项目画像 (~2K tokens)
    │       ├── assembleRelevantCode()    — 代码片段 (最多 50 文件, 3 级压缩)
    │       ├── assembleRelevantMemory()  — 记忆注入 (架构规则/决策/历史)
    │       ├── assembleGlobalMemoryHints() — 全局记忆
    │       └── Memory Kernel Recall      — 认知检索 (12 条, 6K tokens)
    │
    └── handleChatWithTools()  — 工具模式
            ├── preloadContext: 注入 30 个代码片段 + 记忆到 tool-loop 初始消息
            ├── maxRounds: 6 (分析) / 3 (一般)
            └── tokenBudget: 120K chars (分析) / 80K (一般)
```

## 关键设计约束

### 安全边界
- **沙箱系统**: 支持 `none | readonly | isolated` 三级沙箱，限制 Agent 文件写入范围
- **安全规则引擎**: 内置敏感文件检测、危险命令拦截、密钥泄露检测、SQL 注入检测
- **代码审查门禁**: 测试门禁、安全门禁、推理门禁、报告门禁
- **Git Push 控制**: 通过配置安全策略控制是否允许 git push

### 性能基线
- 扫描性能：10K+ 文件项目通过增量指纹跳过未变更文件；并行化文件处理
- Token 预算：分析意图 80K tokens，一般对话 24K tokens；工具模式预加载 30 个代码片段
- 并发控制：Agent 并发上限可配置（默认 3），文件锁定避免并行冲突

### 兼容性要求
- Node.js >= 18.0.0
- 跨平台：Windows / macOS / Linux
- AI Provider 可切换：mock（离线）→ Claude / DeepSeek / OpenAI / Qwen
- 输出格式：CLI 文本 + JSON 双模式

## 代码智能管线 (C9-C12)

```
ic code <subcommand>
    │
    ├── new <描述> [--with-tests]     C1+C4: AI 上下文感知代码生成 → 编译闸门 → 可选测试生成
    ├── fix                           C6: 错误驱动修复 → 读取失败验证记录 → AI 定位修复
    ├── complete <文件>               C2: 补全 TODO/空函数体 → 编译闸门验证
    ├── refactor <描述> [--safe]      C9+C12: 跨文件影响分析 → 搜索所有引用 → 批量 diff
    │       │                                └── --safe: 逐文件备份→写→编译验证→失败回滚
    ├── review [文件]                 C11: 4维审查(安全/风格/bug/性能)→行号报告+评分
    ├── lint-fix [--go]              C10: 读取lint输出→逐文件AI修复→每文件验证→最终确认
    └── scaffold <类型> <名称>       脚手架: crud/middleware/route/component
```

## 文档管线 (D1-D12)

```
ic docs <action>
    │
    ├── status                        文档缺口检测 (9模板)
    ├── generate [type]               AI生成缺失文档 → Agent编排并行 → 质量检查 → 写入
    ├── check                         质量检查 (完整性/准确性/清晰度)
    ├── ask <问题>                    D1: RAG问答 — 全文档分块→相关段检索→AI回答
    ├── summarize <type>              D2: AI文档摘要 (概述/要点/依赖/待办)
    ├── relate <关键词>               D3: 跨文档关联分析 → AI分析依赖/矛盾/缺口
    ├── translate <type> --lang en    D4: 翻译→保持Markdown格式→输出到docs/
    ├── format <type> --to html       D5: 格式转换 (md↔html↔json-outline)
    ├── edit <type> <指令>            DM1: AI增量编辑→自动快照→diff展示
    ├── diff <type>                   DM1: 版本diff可视化
    ├── diff-review <type>            D10: AI审查文档版本差异(新增/删除/语义变化)
    ├── search <关键词>               DM3: 全文搜索
    ├── link                          DM3: 交叉引用索引
    ├── check-consistency             DM3: 文档间一致性检查
    ├── history <type>                DM2: 版本历史
    ├── sync                          DM2: 代码变更→文档影响分析
    ├── toc <type>                    DM3: 生成目录
    └── template                      DM3: 模板管理
```

### 完整数据流 (init→分析→代码→文档)

```
ic init
  └── detectProject() → classifyProjectType() → detectSubprojects()
        └── scanProject(deep=true)
              └── saveProjectIndex()

用户 REPL 输入
  └── classifyIntentRegex() → intent: analysis/code_change/...
        └── buildRichContext(maxTokens=80K analysis / 24K other)
              ├── assembleContextFromProject(deep=true, includeTests=true)
              │     └── scanProject(deep) [if no index]
              ├── assembleContext()
              │     ├── assembleProjectMeta()         ~2K tokens
              │     ├── assembleRelevantCode()         ~60K tokens, 50 files
              │     ├── assembleRelevantMemory()       ~2K tokens
              │     ├── Memory Kernel Recall           12 items, 6K tokens
              │     └── Chinese alias expansion        28 groups
              └── handleChatWithTools()
                    ├── preloadContext: 30 code snippets + memory
                    ├── maxRounds: 6 (analysis) / 3 (other)
                    └── tokenBudget: 120K chars (analysis)

ic code refactor --safe
  └── findSymbolReferences() → 影响分析 → 备份 → 逐文件写入 → runCompileCheck → 失败回滚

ic code review
  └── readFile → AI 4维审查 → Markdown报告 + 评分

ic code lint-fix
  └── resolveVerificationCommand(lint) → execSync → 按文件分组 → AI修复 → 验证

## 回滚管线 (Rollback)

```
ic rollback
    ├── --auto                    自动回滚最近 autopilot 快照
    │     ├── loadLatestAutopilotRollbackPlan()  ← 读取 .icloser/snapshots/
    │     └── rollbackAutopilotChanges()          ← 恢复/删除文件
    ├── --auto --dry-run          预览模式（不实际修改文件）
    │     └── dryRunAutopilotRollback()  →  would-restore / would-delete / no-op
    ├── --list                    列出所有 autopilot 快照
    │     └── listAutopilotRollbackSnapshots()  →  按时间倒序
    └── [task-id]                 基于 Git 的任务回滚（需 Git 仓库）

ic auto docs/tests --go --auto
  └── 写入前: createAutopilotRollbackPlan() → persistAutopilotRollbackPlan()
         └── 验证失败 → runAutopilotRepairLoop()
               ├── buildAutopilotRepairPlan()  ← 尝试自动修复 (最多2轮)
               ├── applyAutopilotRepairPlan()   ← 应用修复
               └── 仍失败 + autoRollback=true:
                     └── rollbackAutopilotChanges()  ← 自动恢复文件

配置项 execution.autoRollbackOnFailure: true 可使 --auto 成为默认行为
```

ic docs ask
  └── loadAllDocs → askDocuments → AI RAG回答

ic docs translate
  └── readFile → translateDocument → writeFile(docs/translations/)

ic docs diff-review
  └── loadDocSnapshot(old) vs readFile(current) → diffReviewDocuments → AI差异报告
```

---

> 本文档由 iCloser autopilot 自动生成草稿，运行 `ic auto docs` 重新生成。
