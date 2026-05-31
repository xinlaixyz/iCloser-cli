# iCloser Agent Shell v0.1.0

> Terminal AI Engineering Assistant — 理解项目、精确编辑、自动验证、生成报告。

## 核心能力

### 项目理解 (100%)
- **11 种语言**自动检测：TS/JS/Go/Python/Rust/Java/Kotlin/C#/PHP/Ruby/Swift
- **16 种框架**识别：React/Vue/SwiftUI/SpringBoot/Django/Flask/Gin/Express/...
- **7 种数据库**检测：PostgreSQL/MySQL/SQLite/MongoDB/Redis/ES/DynamoDB
- **13 种构建系统**：npm/yarn/pnpm/go-mod/gradle/maven/xcode/cocoapods/...
- **454+ 文件**多语言混合扫描（Go + React 全栈项目一次覆盖）

### AI 执行 (100%)
- 5 种 Provider：Claude / DeepSeek / OpenAI / Qwen / Mock
- **5 大工具** × **6 轮循环**：read_file / search_code / run_command / web_search / code_intel
- **Agent 编排**：orchestrator → 并行子 Agent → 汇总结果
- **Agent 沙箱**：none / readonly / isolated 三级安全隔离

### 任务管理 (100%)
- 28 条 CLI 命令 + 32 条 REPL 命令
- 任务引擎：创建/调度/并行/锁/重试/DAG
- **6 道门禁**：测试/安全/推理/报告/回滚/Git
- **验证管线**：compile → lint → test → e2e + 3 轮自动修复

### 上下文引擎 (100%)
- README 全文 + go.mod/package.json 依赖列表
- 扩展名分布统计 + 目录树快照 + 文件清单
- 全局记忆注入：用户偏好/技术栈最佳实践/踩坑记录
- 平台感知：Windows/PowerShell vs Unix/bash 自动适配

### 开发者体验 (100%)
- `--json` 输出覆盖所有核心命令
- 分析任务自动跳过验证管线
- `ic t --retry <task-id>` 失败任务重试
- REPL `/history` 对话历史搜索
- 完善的中文错误提示和操作建议

## 快速开始

```bash
npm install -g icloser
ic setup --mock          # 离线体验
ic init                  # 初始化项目
ic t "你的任务" --go      # 创建并执行
```

## 系统要求

- Node.js >= 18
- 支持 Windows / macOS / Linux

## 406 测试 / 0 失败

```
Test Files:  42 passed
Tests:       413 passed
Smoke:all:   15 gates passed
```
