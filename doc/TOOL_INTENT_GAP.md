# AI 工具意图管理差距分析

## 对比基准

同一项目 `D:\temp\Codex\icloser-forge`，同一模型。

### 对比工具的工具使用策略

```
意图: 分析项目
  │
  ├─ Phase 1: Explore(structure, 40 tools)
  │     list dirs → find *.ts → find *.json → read package.json → read tsconfig.json
  │     → 有条理、有计划、每步基于上一步结果
  │
  ├─ Phase 2: 并行 Explore (3 agents × 50 tools)
  │     Agent A: 读 task 文件 → 找阻塞项 → 读 report
  │     Agent B: 数 test 文件 → 读 test 内容 → 找缺失覆盖
  │     Agent C: 数 CLI 命令 → 读 IDE 代码 → 查 CI 配置
  │     → 目标明确，分工清晰
  │
  └─ Phase 3: Synthesize
        → 汇总 → 结构化报告
```

### iCloser 的工具使用策略

```
意图: 分析项目
  │
  ├─ 组装上下文 (1-2K tokens)
  │
  ├─ 工具调用循环 (6-8 轮)
  │     R1: read README, search_code "handler"
  │     R2: read main.go, read go.mod, run_command (Unix on Windows → fail)
  │     R3: read random file, search_code "route", search_code "api"
  │     → 无策略，随机探索
  │
  └─ 合成 (AI 调用)
```

## 5 个断层

### TI1: 无意→工具策略映射

**问题**: AI 不知道对每个意图应该优先用哪些工具、按什么顺序。

```
现状: AI 自由探索
理想: 意图=analysis → 策略:
  1. read_file README.md (理解项目)
  2. read_file package.json/go.mod (技术栈)
  3. search_code "handler|route|api" (找功能)
  4. read_file 关键源文件 (深入理解)
  5. 输出分析报告
```

**在哪实现**: `buildSystemPrompt()` → 注入意图→策略映射表

### TI2: 工具选择质量低

**问题**: AI 在 Windows 上 run_command `ls` / `find` / `grep` 失败。

```
R3: run_command "find . -name '*.go'" → Unix command, Windows 失败
R5: run_command "Get-ChildItem"        → PowerShell, Bash 失败
```

**根因**: 平台感知只在 system prompt 中提示，AI 不一定遵循。

**在哪实现**: 增强 `executeToolCall()` → `run_command` 自动平台适配

### TI3: 工具结果未压缩

**问题**: read_file 返回 5000 行源码，全部注入下一轮 context。Token 浪费，AI 注意力分散。

**根因**: 工具结果直接拼接，无摘要/压缩。

**在哪实现**: `executeToolCall()` → 返回前自动压缩大结果

### TI4: 探索无进度反馈

**问题**: 用户看到 "AI 执行中... (第 3/6 轮)" 但不知道 AI 在读什么文件、发现了什么。

**根因**: `detail('工具: read_file', '✓')` 只显示工具名，不显示读的文件名和发现摘要。

**在哪实现**: 增强 `detail()` 调用 → 显示文件名 + 关键发现

### TI5: 无自适应重试

**问题**: AI 搜索 "package.json" 返回空 → 继续搜索同样关键词。不会换策略。

**根因**: 工具结果注入时无"已尝试但失败"的标记。

**在哪实现**: 工具调用循环 → 记录已尝试的策略，注入 context

## 优先级

| 优先级 | 断层 | 效果 | 复杂度 |
|--------|------|------|--------|
| 🔴 P0 | TI4 进度反馈 | 用户知道AI在做什么 | 低 |
| 🔴 P0 | TI1 策略映射 | AI知道该用什么工具 | 中 |
| 🟡 P1 | TI3 结果压缩 | 节省token,提升质量 | 低 |
| 🟡 P1 | TI2 平台适配 | 消除跨平台失败 | 中 |
| 🟢 P2 | TI5 自适应重试 | 减少无效重复 | 中 |
