# AgentCode -- 架构设计文档

## 架构概览

项目 AgentCode 采用分层 + 模块化架构组织代码。技术栈为 TypeScript。
系统分为以下核心层次：

- **CLI 层** (`src/cli/`): 命令解析、终端 UI、REPL 交互、输出格式化
- **核心服务层** (`src/core/`): 扫描器、任务引擎、验证器、上下文组装、审计、安全
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
- 测试框架：vitest (37 个测试文件)
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
│   │   ├── memory.ts         记忆系统
│   │   ├── audit.ts          审计日志
│   │   ├── security.ts       安全规则
│   │   ├── autopilot.ts      自动分析
│   │   ├── autodoc.ts        自动文档生成
│   │   ├── autotest.ts       自动测试生成
│   │   ├── autopilot-verify.ts  自动验证
│   │   ├── autopilot-repair.ts  自动修复
│   │   ├── autopilot-router.ts  自动路由
│   │   ├── autopilot-rollback.ts 自动回滚
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
│   └── (37 个测试文件)
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
    ├── detectProject()     — 语言/框架检测
    ├── findFiles()         — 文件发现
    ├── filterBySize()      — 按尺寸/文本过滤 (并行)
    ├── computeFingerprints — 比对 mtime+size 指纹
    │       └── 未变更文件跳过重新解析
    ├── extractModules()    — 模块提取 (增量合并)
    ├── extractApiEndpoints — API 端点检测
    └── 构建依赖图 + 调用图
```

## 关键设计约束

### 安全边界
- **沙箱系统**: 支持 `none | readonly | isolated` 三级沙箱，限制 Agent 文件写入范围
- **安全规则引擎**: 内置敏感文件检测、危险命令拦截、密钥泄露检测、SQL 注入检测
- **代码审查门禁**: 测试门禁、安全门禁、推理门禁、报告门禁
- **Git Push 控制**: 通过配置安全策略控制是否允许 git push

### 性能基线
- 扫描性能：10K+ 文件项目通过增量指纹跳过未变更文件；并行化文件处理
- Token 预算：上下文组装按 token 预算分配，优先高相关性代码片段
- 并发控制：Agent 并发上限可配置（默认 3），文件锁定避免并行冲突

### 兼容性要求
- Node.js >= 18.0.0
- 跨平台：Windows / macOS / Linux
- AI Provider 可切换：mock（离线）→ Claude / DeepSeek / OpenAI / Qwen
- 输出格式：CLI 文本 + JSON 双模式

---

> 本文档由 iCloser autopilot 自动生成草稿，运行 `ic auto docs` 重新生成。
