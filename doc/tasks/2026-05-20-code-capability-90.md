# 代码能力冲 90 分任务文档

日期：2026-05-20
基线：112 文件 / 1640 测试 / 0 失败 / 代码能力评分 83.6/100
目标：代码能力全部模块达到 90 分以上

---

## 已完成工作总览（4 轮，5 个提交）

| 提交 | 轮次 | 修复数 | 领域 |
|------|------|--------|------|
| `7562e84` | 缺陷修复 | 6 | 配置合并隔离、DeepSeek流式上下文、任务ID碰撞、AI契约校验、pMap错误日志、readFile路径保护 |
| `d86877f` | 缺陷修复 | 2 | verifier修复循环并行读取、memory TTL过期自动清理 |
| `afacdbd` | 缺陷修复 | 8处 | 全模块 Math.random() → crypto.randomUUID()（agent/audit/memory共5文件） |
| `f3caed7` | 代码能力 | 8 | autotest exports修复、toPromise类型安全、provider any消除、ts-dataflow正则升级、gen去重、编译门禁扩展、doc-reader优化、TS Program缓存 |
| `0c6f8c4` | 代码增强 | 4 | DDG双后端+磁盘缓存、危险命令补全+dry-run、4策略JSON解析、Go/Python/Java脚手架 |

**累计：20 项缺陷修复 + 4 项功能增强，零回归。**

---

## 当前各模块评分

| 模块 | 评分 | 距90分差距 | 未达标原因 |
|------|------|-----------|---------|
| 工具策略 | **91** | ✅ 已达标 | 新模块，14种意图映射，零缺陷 |
| CLI 命令 | **90** | ✅ 已达标 | commands/ 提取后 index.ts 从5000→4222行 |
| AI Provider | **90** | ✅ 已达标 | OpenAICompatibleProvider 基类消除重复 |
| AST 解析 | 86 | -4 | 缺 C/C++/Rust tree-sitter 解析器 |
| REPL | 86 | -4 | 3474行单体，handleInlineConfirm 10种条件分支 |
| 安全门禁 | 86 | -4 | git.ts 敏感文件 glob 匹配不完整 |
| 记忆系统 | 83 | -7 | manifest 跨Agent互操作待扩展 |
| 上下文装配 | 83 | -7 | 评分阶段和装配阶段重复读取文件 |
| Web 搜索 | 82 | -8 | 磁盘缓存未与 searchWeb 的 rootPath 集成 |
| 工具执行器 | 82 | -8 | dry-run 已加入，但代码智能未返回 dataFlow |
| 代码生成 | 80 | -10 | code new 生成后未走 verify 回路 |
| 验证管线 | 75 | -15 | 阶段串行执行，非TS语言静默跳过 |
| 自动测试 | 70 | -20 | exports 已修复，但无 AI 驱动断言 |
| TS 数据流 | 72 | -18 | 被调用者提取仍用正则（已部分改进），跨文件流仅 TS |

---

## 冲 90 分路线图（仅模块内部改动，不动架构）

### 阶段一：低挂果实（估 4h）

| # | 模块 | 当前→目标 | 动作 | 估时 | 依赖 |
|---|------|----------|------|------|------|
| T1 | Web 搜索 | 82→88 | searchWeb 接收 rootPath 参数，磁盘缓存存入 `.icloser/web-cache.json` | 1h | 无 |
| T2 | 工具执行器 | 82→86 | code_intel 返回 dataFlow 信息（已有解析逻辑，未接入返回） | 1h | 无 |
| T3 | 安全门禁 | 86→90 | matchSensitivePattern 补全 `**/` 和 `{a,b}` glob 模式 | 0.5h | 无 |
| T4 | 代码生成 | 80→86 | runGenNew 增加 verify 参数 → generateWithVerifyLoop 替代 runCodeGenerationPipeline | 1.5h | 无 |

### 阶段二：中等深度（估 8h）

| # | 模块 | 当前→目标 | 动作 | 估时 | 依赖 |
|---|------|----------|------|------|------|
| T5 | 上下文装配 | 83→90 | 评分阶段缓存 fileContent → Map，装配阶段复用（消除二次 I/O）；token 预算按任务类型动态分配 | 3h | 无 |
| T6 | TS 数据流 | 72→84 | buildCrossFileFlow 用 checker.getSymbolAtLocation 解析调用目标（替代正则）；扩展 .js/.jsx 支持 | 3h | 无 |
| T7 | 记忆系统 | 83→90 | manifest.ts 支持 YAML frontmatter 解析；exportAgentMemoryManifest Windows 驱动器号修复 | 2h | 无 |

### 阶段三：深水区（估 12h）

| # | 模块 | 当前→目标 | 动作 | 估时 | 依赖 |
|---|------|----------|------|------|------|
| T8 | REPL | 86→92 | 提取 `repl-chat.ts`（聊天+工具循环）、`repl-panels.ts`（确认面板+系统审批）；handleInlineConfirm 策略模式 | 4h | 架构师配合拆分 |
| T9 | 验证管线 | 75→90 | 阶段并行执行（Promise.all）；覆盖率连续3次下降告警；非TS语言至少语法检查 | 4h | 需与架构师确认并行安全性 |
| T10 | 自动测试 | 70→90 | AI驱动测试生成：读函数签名→生成有意义的断言→运行→失败→修复回路（最多3轮）；async/回调/错误路径的对应测试模式 | 4h | 依赖 T9 的并行化 |

### 阶段四：补全（估 6h）

| # | 模块 | 当前→目标 | 动作 | 估时 | 依赖 |
|---|------|----------|------|------|------|
| T11 | AST 解析 | 86→92 | 加入 C/C++/Rust tree-sitter 解析器；Go/Python 数据流分析（当前始终为空） | 4h | tree-sitter-c, tree-sitter-cpp, tree-sitter-rust 依赖包 |
| T12 | Web 搜索 | 88→92 | 搜索结果缓存预热：后台线程定期搜索项目相关热词，提高首次命中率 | 2h | 无 |

---

## 验收标准

| 模块 | 90分验收标准 |
|------|------------|
| Web 搜索 | 3层回退均可用（DDG JSON → DDG HTML → 磁盘缓存），磁盘缓存跨进程持久 |
| 工具执行器 | code_intel 返回 dataFlow 边 + callGraph 调用者 |
| 安全门禁 | glob 完整支持 `**/`、`{a,b}`、`[abc]` |
| 代码生成 | code new --verify 默认走 generateWithVerifyLoop（生成→验证→修复） |
| 上下文装配 | 文件内容只读一次（评分+装配共享缓存），token 预算动态分配 |
| TS 数据流 | buildCrossFileFlow 用 TS type checker 解析调用目标；.js/.jsx 文件参与分析 |
| 记忆系统 | manifest 支持 YAML frontmatter；Windows 路径安全 |
| REPL | 聊天逻辑独立模块；确认面板策略模式可扩展 |
| 验证管线 | 并行化无竞态；覆盖率追踪可审计 |
| 自动测试 | AI 生成的测试包含 ≥1 个行为断言（非仅 typeof 检查） |

---

## 不在此范围（需架构师决策）

| 项目 | 原因 |
|------|------|
| taskStore 事务回滚 | 需引入 WAL 或 checkpoint 机制 |
| 全局状态隔离（DI 容器） | 影响所有测试和模块初始化 |
| Provider 热切换 | 需配置监听 + 运行时重建 |
| 国际化（i18n） | UI 文本提取 + 翻译框架 |
| index.ts 剩余命令提取 | setup/autopilot/docs/code/gen 仍在 index.ts，需架构师决定提取边界 |
