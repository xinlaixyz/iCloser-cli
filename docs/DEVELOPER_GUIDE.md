# iCloser Agent Shell — 开发者指南

版本: 0.1.0 | 日期: 2026-05-15 | 状态: 82% 完成

---

## 1. 项目概览

iCloser Agent Shell 是一个**终端 AI 工程助手**。理解项目结构 → 精确修改代码 → 自动验证 → 生成报告。

```
技术栈:  TypeScript + Node.js >= 18
架构:    CLI → Core → Agent → AI Provider
测试:    44 files / 432 tests / 0 failed
提交:    58 commits
许可证:  MIT
```

### 快速开始

```bash
git clone <repo-url>
cd AgentCode
npm install
npm run build       # tsc 编译到 dist/
npm test            # 432 tests, ~13s
npm run smoke       # 14 smoke gates
node dist/index.js  # 启动 REPL
```

---

## 2. 目录结构

```
src/
├── index.ts              # CLI 入口 (ic setup/scan/t/agent/provider/docs/...)
├── config.ts             # 配置加载/保存
├── types.ts              # 全局类型定义
│
├── cli/                  # 终端交互层
│   ├── repl.ts           # REPL 对话循环 (2500+ 行, 核心)
│   ├── tui.ts            # 底部面板 + InputBox(未启用)
│   ├── output.ts         # 格式化输出 + 消毒过滤器 + 错误指引
│   ├── theme.ts          # 颜色/框线/图标 设计系统
│   ├── diff-renderer.ts  # Diff 红绿着色
│   ├── choice-panel.ts   # 中文选择面板
│   ├── system-approval.ts# 系统操作审批
│   ├── system-runner.ts  # 后台进程管理
│   ├── loop-panel.ts     # 循环状态面板(已降级为单行)
│   ├── format.ts         # 状态/门禁格式化
│   ├── json.ts           # JSON envelope 契约
│   └── tui.ts            # 终端UI渲染
│
├── core/                 # 核心服务层
│   ├── task-engine.ts    # 任务创建/调度/并行/锁/DAG
│   ├── task-loop.ts      # 三步循环 (收集→执行→验证)
│   ├── tool-registry.ts  # 五工具能力注册表
│   ├── tool-executor.ts  # AI tool_call → 本地执行
│   ├── scanner.ts        # 项目扫描 + 调用图 + 增量指纹
│   ├── scanner-worker.ts # Worker Thread 正则提取
│   ├── ast-parser.ts     # 多语言 AST (9语言+regex降级)
│   ├── verifier.ts       # 验证引擎 (编译→lint→test→e2e)
│   ├── context.ts        # 上下文组装 (记忆/搜索/AST注入)
│   ├── web-search.ts     # DuckDuckGo 网络搜索
│   ├── memory.ts         # 分层记忆 (短期/任务/长期)
│   ├── security.ts       # 安全层 (三级执行)
│   ├── autopilot.ts      # 项目自动分析
│   ├── autodoc.ts        # 自动文档生成
│   ├── autotest.ts       # 自动测试生成
│   ├── autopilot-repair.ts
│   ├── autopilot-verify.ts
│   ├── autopilot-rollback.ts
│   ├── autopilot-router.ts
│   ├── execution-chain.ts# 10阶自动执行链
│   ├── docs-generator.ts  # 文档生成+ask/summarize/review
│   ├── intent-classifier.ts
│   └── audit.ts
│
├── agent/
│   └── manager.ts        # Agent 管理器(创建/启停/编排)
│
├── ai/
│   ├── provider.ts       # 5 家 Provider 适配
│   ├── errors.ts         # AI 错误分类
│   └── output-contract.ts# 结构化输出契约
│
├── gate/
│   └── checker.ts        # 6 道质量门禁
│
├── report/
│   └── generator.ts      # 中文报告生成
│
├── skill/
│   └── manager.ts        # 内置 4 个 Skill
│
└── utils/
    ├── fs.ts             # 文件系统工具
    ├── git.ts            # Git 工具
    └── detect.ts         # 11 语言自动识别

tests/                    # 44 测试文件, 432 tests
docs/                     # 产品/UI/API/测试 文档
doc/                      # 架构/状态/任务 文档 (~100 篇)
skills/                   # 内置 Skill 定义 (4 个)
scripts/                  # Smoke 测试脚本 (18 个)
templates/                # Diff/报告 模板
```

---

## 3. 架构分层

```
Human
  │ 自然语言 / CLI命令 / REPL对话
  ▼
CLI Layer (src/cli/, src/index.ts)
  ├── 30+ 斜杠命令
  ├── 流式输出 + 消毒
  ├── 状态栏 + 快捷键
  └── 系统操作审批面板
  │
  ▼
Core Layer (src/core/)
  ├── 任务引擎 → 三步循环 → 验证
  ├── Agent 编排 → 并行执行 → 汇总
  ├── 上下文组装 → AI prompt
  └── 记忆系统 → 长期存储
  │
  ▼
AI Layer (src/ai/)
  ├── Provider 适配 (5家)
  └── 输出契约解析
```

---

## 4. 完成度

### 功能完成度: 82%

| 域 | 完成度 | 关键文件 |
|----|--------|---------|
| 核心引擎 | 100% | task-engine, task-loop, agent/manager |
| 工具链 | 95% | scanner, ast-parser, docs-generator |
| 质量保障 | 90% | verifier, gate/checker, security |
| UI/UX | 98% | cli/repl, cli/output, cli/diff-renderer |
| 部署运维 | 60% | install scripts, .github/workflows |
| 生态扩展 | 20% | 未开始 |

### S20-S22 UI 详情

| # | 功能 | 状态 |
|----|------|------|
| S20.1 | 输出消毒 | 100% |
| S20.2 | 等待动画(脉冲+计时) | 100% |
| S20.3 | 状态栏(4模式自适应) | 100% |
| S20.4 | Diff红绿着色 | 100% |
| S20.5 | 输入框 | 100% (readline) |
| S20.6 | 错误恢复指引 | 100% |
| S20.7 | 命令面板 | 100% (/? /p + 29条过滤) |
| S20.8 | 历史搜索 | 100% (!query + !N 复用) |
| S20.9 | Tab补全 | 100% |
| S21.0 | 流式进度+代码折叠+TLDR | 100% |
| S21.1 | 编排树+面板精简 | 100% |
| S22.0 | 上下文仪表+brief/full | 100% |
| P2#6  | /export md 对话导出 | 100% |
| P2#7  | /theme dark/light | 100% |

---

## 5. 剩余差距

### P0 — 阻塞发布

| # | 任务 | 说明 | 估时 |
|---|------|------|------|
| 1 | NPM 发布 | `package.json` 完善 + `npm publish` CI | 4h |
| 2 | CI/CD 完善 | 多平台构建矩阵 + 自动发布 | 6h |

### P1 — 功能完整

| # | 任务 | 说明 | 估时 |
|---|------|------|------|
| 3 | 安全沙箱进程隔离 | Agent 执行隔离到子进程 | 8h |
| 4 | 大项目性能基准 | 10K+ 文件项目扫描测试 | 4h |
| 5 | 真实验收测试 | 对接真实 AI Provider 的 E2E | 8h |

### P2 — 体验优化

| # | 任务 | 说明 | 估时 |
|---|------|------|------|
| 6 | 输出导出 | /export md 导出对话为 Markdown | 2h |
| 7 | 主题切换 | /theme dark/light | 2h |
| 8 | Shift+Enter 多行 | 需要终端兼容方案 | 8h+ |

### P3 — 生态

| # | 任务 | 说明 | 估时 |
|---|------|------|------|
| 9 | VSCode 插件 | 降低使用门槛 | 40h+ |
| 10 | 插件系统 | 第三方扩展机制 | 20h+ |

---

## 6. 关键技术决策

### 为什么要 readline 而非 raw mode
- raw mode 破坏 CJK IME 中文输入
- raw mode 下 `\x1b[NA` 光标控制在 Windows 终端不可靠
- readline 原生支持历史/补全/行编辑

### 为什么放弃固定面板
- 终端无 `position: fixed` 机制
- Alternate screen buffer 会隐藏聊天历史
- 最终选择: 单行状态栏 + 自然滚动

### 为什么不用 blessed/ink TUI 框架
- 增加重量级依赖
- 与现有 readline 生态冲突
- 当前纯文本方案跨平台兼容性最好

---

## 7. 开发约定

### 代码风格
- 2 空格缩进, 双引号, 无分号
- 函数/变量用 camelCase, 类型用 PascalCase
- 中文注释允许, 英文注释优先

### 测试
```bash
npm test                    # 全量 432 tests
npx vitest run tests/xxx    # 运行单个文件
```

### 新增命令
1. 在 `src/index.ts` 添加 `program.command()`
2. 在 `src/cli/repl.ts` `SLASH_COMMANDS` 中添加
3. 在 `renderCommandPalette()` 中添加条目
4. 在 `handleSlashCommand()` `switch` 中添加 case
5. 写测试文件

### 新增 Provider
1. 在 `src/ai/provider.ts` 实现 `XxxProvider` 类
2. 在 `getAvailableProviders()` 中注册
3. 在 `createProvider()` 中添加工厂方法

---

## 8. 常见问题

**Q: `tsc --noEmit` 报类型错误?**
A: 部分 pre-existing 错误来自 linter 的 cmdStartProject 展开。`npx tsc` (不加 --noEmit) 可正常编译。

**Q: spawn 测试失败?**
A: 需要 `npx tsc` 先编译 dist/, 再运行测试。

**Q: 中文乱码?**
A: 确保终端使用 UTF-8 编码。Windows Terminal 推荐。

**Q: API Key 怎么配置?**
A: 启动 REPL 后输入 `/apikey`, 或运行 `ic setup`。

---

## 9. 变更日志

| 日期 | 版本 | 内容 |
|------|------|------|
| 2026-05-15 | 0.1.0 | S20-S22 UI 重构 + docs 操作 + 82% 完成 |
| 2026-05-14 | 0.1.0-rc | S19 缺口清零, 354→383 tests |
| 2026-05-13 | 0.0.9 | S17-S18 编排+工具调用 |
| 2026-05-12 | 0.0.8 | S1-S16 核心功能 |

---

> 本文档面向接续开发者。运行 `npx tsc && node dist/index.js` 启动 REPL 测试。
