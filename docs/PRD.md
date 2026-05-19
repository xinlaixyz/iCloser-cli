# AgentCode -- 产品需求文档

## 项目简介

AgentCode 是基于 TypeScript 的 AI 工程执行 CLI 系统。它能够理解项目结构、自动生成和执行代码变更、运行质量门禁检查、生成报告，并维护项目级记忆。

## 核心功能

### 1. 项目扫描与索引 (`scan`)
- 自动检测项目语言、框架、构建系统、测试框架、数据库、运行时
- 全量扫描源码文件，提取模块结构、导出符号、导入依赖
- AST 增强解析（支持 TypeScript/JavaScript/Go/Python/Java 等 12+ 语言）
- 增量扫描：基于文件 mtime+size 指纹跳过未变更文件的重新解析，适用于 10K+ 文件大型项目
- 跨文件调用图构建
- 架构模式自动识别（MVC、Clean Architecture、Microservices、Layered 等）

### 2. 任务执行 (`t / task`)
- 自然语言任务描述 → AI 自动规划执行步骤
- 任务优先级调度（high / normal / low）
- 文件锁定机制防止并行任务冲突
- 三步循环：收集上下文 → 执行操作 → 验证结果
- AI 工具调用循环：AI 可自主调取代码搜索、文件读写等工具完成复杂任务
- 自动修复循环：验证失败后 AI 自动修复代码并重新验证
- Agent 自动桥接：每个任务自动关联一个 Agent 实体，通过 Agent 系统驱动执行

### 3. 质量门禁 (`gate`)
- 六道门禁：测试、安全、推理、报告、回滚、Git
- 安全扫描：敏感文件、危险命令、密钥泄露、SQL 注入检测
- 验证结果与修复轮次追踪

### 4. 多 Agent 系统 (`agent`)
- 五种 Agent 类型：task / review / verify / explore / orchestrator
- Agent 生命周期管理：创建 → 启动 → 暂停 → 恢复 → 停止
- 编排模式：父 Agent 拆解任务 → 子 Agent 并行执行 → 汇总结果
- Agent 间通信：消息总线
- 共享上下文机制
- 三级沙箱隔离：none / readonly / isolated

### 5. 自动文档与测试 (`auto`)
- 自动分析项目结构、代码质量、文档缺口和测试缺口
- 自动生成缺失的架构文档、API 文档、测试说明
- 自动生成安全的最小测试文件
- 写入 → 验证 → 修复 → 重试 → 回滚 的自动修复管线
- `--auto` 验证失败自动回滚；`execution.autoRollbackOnFailure` 可设为默认
- `ic rollback --auto` 手动回滚最近 autopilot 快照
- `ic rollback --auto --dry-run` 预览回滚而不执行
- `ic rollback --list` 列出所有已保存的回滚快照

### 6. Memory Kernel v1.0 — 认知记忆核心 (`mem`) ✅ 已完全激活

#### 6.1 感官记忆层 (Sensory Buffer)
- FIFO 队列，5-60s TTL，低价值信息自动过滤
- 数据源：CLI 输入、Shell 输出、Git Diff、编译日志、测试结果、安全日志
- 高价值关键词自动标记（错误/崩溃/严重/紧急等）

#### 6.2 工作记忆层 (Working Memory)
- 16k-32k token 动态管理，分层结构
- Token 预算监控（70% 警告，90% 压缩）
- 快照/恢复机制

#### 6.3 情景记忆 (Episodic Memory)
- 事件日志 JSONL + SQLite 索引，按月分片；Node 18/20 下 SQLite 不可用时自动使用 JSONL 查询兜底
- 时间轴查询、任务关联、标签检索
- 自动从 git 历史 import 50 条最近 commit

#### 6.4 语义记忆 (Semantic Memory)
- 规则树 (domain/platform/area 分层)
- 置信度评分 + 验证计数 + 来源追溯
- 自动从代码配置提取规则（TS strict/ESLint/Vitest/Docker）

#### 6.5 Recall 检索引擎
- 三种 Recall：Timeline（时间轴）/ Semantic（关键词）/ Emotion（重要度）
- Ranking 公式：SemanticSimilarity + TimelineRelevance + EmotionalWeight + RecentUsage + TaskSimilarity
- Top-K=5，Token 限制 2000，防上下文爆炸

#### 6.6 智能引擎
- **Salience Engine**: 重要度评分（关键词加权 + 反馈 + 重复 + 时间衰减）
- **Forgetting Engine**: M(t)=M0×e^(-t/S) 遗忘曲线，分级半衰期
- **Consolidation Engine**: 情景→摘要→语义规则自动抽象

#### 6.7 自动激活 (Zero-Config)
- `ic init` → 自动 bootstrap (git 历史 + 代码模式 + 初始固化)
- 每次 AI 对话 → 自动 Recall → 上下文注入
- 每次对话结束 → 自动记录情景事件
- 每 5 次任务 → 自动固化规则

### 7. AI Provider 管理 (`provider`)
- 多 Provider 抽象层，统一接口
- 支持 Provider：Claude (Anthropic SDK)、DeepSeek、OpenAI、Qwen
- 离线 mock Provider（无需 API Key 即可开发测试）
- API Key 安全存储与脱敏显示
- Provider 健康检查与自动诊断
- 自动 Key 格式推断 Provider 类型

### 8. CLI 与 REPL
- 命令行模式：`ic <command>` 单次执行
- REPL 交互模式：持续对话，支持 `/run` 调用 Agent
- 输出双模式：文本（人类可读）/ JSON（机器可解析）
- 配置管理：项目级 + 全局级配置

## 技术栈

- 语言：TypeScript (ES2022)
- 框架：无（vanilla）
- 构建：npm (tsc)
- 测试：vitest（37 个测试文件 + 18 个 smoke 脚本）
- 运行时：>=18.0.0（Node 24+ 自动启用 SQLite 记忆索引；Node 18/20 使用 JSONL/rules 文件降级）
- 包管理器：npm
- 部署形态：CLI 工具，npm 包发布

规模：42 个源码文件分布在 8 个模块中。

## 用户角色

- **开发者**: 使用 CLI 执行任务、查看报告、管理项目记忆
- **技术负责人**: 配置架构约束、审查安全门禁结果、管理团队代码质量
- **CI/CD 系统**: 通过 JSON 输出模式集成到自动化流水线
- **AI Agent**: 通过 Agent 管理器驱动，自主执行代码分析和变更

## 非功能需求

### 性能
- 全量扫描 10K+ 文件项目应在 30 秒内完成（增量扫描 < 5 秒）
- AI 调用超时默认 120 秒
- 工具调用循环最多 5 轮
- 自动修复最多重试 2 轮

### 安全
- API Key 全局加密存储，脱敏显示
- 危险命令黑名单机制
- 敏感文件路径匹配拦截
- Agent 沙箱隔离（readonly / isolated）
- Git push 操作默认禁止，需显式配置允许

### 可维护性
- 模块化架构：CLI / Core / Agent / AI / Gate / Report 分层清晰
- 类型安全：TypeScript strict 模式
- 质量门禁：每次提交通过六道检查
- 审计日志：所有 Agent 操作可追溯

### 兼容性
- 跨平台：Windows 11 / macOS / Ubuntu
- AI Provider 无感切换
- stdout/stderr 输出兼容管道和重定向
- JSON 输出信封格式版本化

---

## UI/UX 设计 (S20)

详见 [`docs/UI.md`](./UI.md)

### 输入系统
- 双线输入框：Unicode 框线围住输入区域，视觉区分对话区
- 多行支持：Shift+Enter 换行，最大 6 行可视，超出滚动
- 历史导航：↑↓ 翻历史，Ctrl+R 搜索历史
- 命令面板：Ctrl+P 模糊搜索全部命令

### 变更预览
- Diff 红绿着色：删除行红色，新增行绿色，未变更行灰色
- 代码文件和 Markdown 文档统一着色规则

### 输出安全
- 消毒过滤器：过滤 ASCII 控制字符、未闭合 ANSI 序列
- 超长行截断 (>1000 字符)

### 等待反馈
- 三阶段反馈：连接中 → 分析中(带计时) → 流式输出(带 token 计数)
- 脉冲动画 + 进度条，消除"卡死"感

### 底部固定操作面板
- 空闲：快捷命令栏 (help/scan/write/diff/clear...)
- 有文件：待写入文件列表 + [w/d/x] 操作
- AI 执行中：状态信息 + 计时器
- 验证完成：结果图标 + [c/u/r] 操作

### 错误恢复
- 编译/测试/门禁失败时自动提取错误详情
- 提供优先级排序的修复建议

---

> 本文档由 iCloser autopilot 生成，S20 UI 章节为手动补充。运行 `ic auto docs` 重新生成。
