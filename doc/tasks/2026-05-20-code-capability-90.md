# 代码能力冲 90 分任务文档（终版）

日期：2026-05-20
基线：70 源文件 / 1346 测试 / 代码能力 72.6/100
工程师终态：70+ 源文件 / 1714 测试 / 代码能力 85.7/100
架构师验收终态（2026-05-21）：116 测试文件 / 1715 passed / 2 skipped，代码能力维持 **85.7/100**，但需以“修复补漏后通过”为准。

---

## 全部提交记录（今日 7 个提交）

| 提交 | 轮次 | 内容 |
|------|------|------|
| `7562e84` | 缺陷修复 | 配置合并隔离、DeepSeek流式上下文、任务ID碰撞、AI契约校验、pMap错误日志、readFile路径保护 |
| `d86877f` | 缺陷修复 | verifier修复循环并行读取、memory TTL过期自动清理 |
| `afacdbd` | 缺陷修复 | 全模块 Math.random() → crypto.randomUUID()（5文件8处） |
| `f3caed7` | 代码能力 | autotest exports修复、toPromise类型安全、provider any消除、ts-dataflow正则升级、gen去重、编译门禁扩展(Rust/C#/Java)、doc-reader优化、TS Program LRU缓存 |
| `0c6f8c4` | 代码增强 | DDG HTML双后端+磁盘缓存、危险命令补全(19种)+dry-run预览、4策略JSON解析、Go/Python/Java脚手架 |
| `a9da4d3` | 阶段二 | memory manifest YAML frontmatter解析 |
| `ebe2f96` | 阶段二 | ts-dataflow buildCrossFileFlow type checker符号解析（替代正则） |
| `fcffd72` | 阶段三 | T10 AI驱动测试生成 — 分析函数签名→行为断言→验证修复回路(3轮) |
| `91bf6f9` | 阶段三+四 | T4b 代码审查结构化(4维评分+问题清单) + T11 C/C++/Rust解析器+Go/Python数据流 |

**累计：22 项修复 + 12 项增强 = 34 项质量增量。架构师全量验收发现 1 个测试加载回归与 1 个工具链路漏接，已补齐后全量通过。**

---

## 架构师验收补充（2026-05-21）

| 项目 | 结果 |
|------|------|
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 通过，`eslint ok (9 warnings)` |
| `npm test` | 116 测试文件通过；1715 passed / 2 skipped |
| 代码能力定向测试 | 9 个测试文件，171 passed |
| 文档/PDF/工具补漏测试 | 3 个测试文件，104 passed |

补漏项：

- `src/core/tool-executor.ts`：`web_search` 工具入口补传 `rootPath`，让 `.icloser/web-cache.json` 项目级磁盘缓存真正接入工具主链路。
- `tests/tool-executor-web-search-root.test.ts`：新增回归测试，锁住 web_search 的项目级缓存参数。
- `src/core/doc-reader.ts`：修复 `pdfParse` 重复声明导致 Vitest/esbuild 加载失败的问题。
- `src/core/tool-executor.ts`：为 `read_pdf` 工具增加 PDF parser 噪音抑制，避免工具结果被 stderr warning 污染。

详细验收见 `doc/ARCHITECT_ACCEPTANCE_CODE_CAPABILITY_2026-05-21.md`。

---

## 终态各模块评分

| 模块 | 评分 | 状态 | 备注 |
|------|------|------|------|
| 工具策略 | **91** | ✅ | 新模块，14种意图映射，零缺陷 |
| AST 解析 | **92** | ✅ | T11: +C/C++/Rust tree-sitter + Go/Python数据流 |
| CLI 命令 | **90** | ✅ | commands/ 提取，index.ts 5000→~2200行 |
| AI Provider | **90** | ✅ | OpenAICompatibleProvider 基类消除重复 |
| 安全门禁 | **86** | ⬆ | git.ts glob补全、commit-security.ts提取（架构师） |
| REPL | **86** | ⬆ | 3474行单体，tool-display.ts已提取（架构师） |
| 记忆系统 | **86** | ⬆ | T7 manifest YAML frontmatter |
| 代码生成 | **86** | ⬆ | T4 verify回路 + T4b code review结构化 |
| TS 数据流 | **84** | ⬆ | T6 type checker符号解析 + C8 Program缓存 |
| 自动测试 | **84** | ⬆ | T10 AI驱动断言 + 增强模板(参数推断) |
| 上下文装配 | **83** | ⬆ | 架构师已修：评分缓存→装配复用 |
| Web 搜索 | **82** | ⬆ | 阶段一: DDG HTML后备 + 磁盘缓存 + rootPath |
| 工具执行器 | **82** | ⬆ | 阶段一: code_intel dataFlow + 19种危险命令 + dry-run |
| 验证管线 | **75** | ⬜ | 架构师立项：第一阶段并行compile/lint |

**综合：85.7/100**（从 72.6 提升 13.1 分）

---

## 已完成任务明细

| # | 任务 | 模块 | 评分变化 | 提交 |
|---|------|------|---------|------|
| C1 | autotest exports参数传入 | 自动测试 | D→B (35→70) | f3caed7 |
| C2 | toPromise类型安全 | AST解析 | — | f3caed7 |
| C3 | provider: any → AIProviderAdapter | 代码生成 | +8 | f3caed7 |
| C4 | ts-dataflow 被调用者正则升级 | TS数据流 | +3 | f3caed7 |
| C5 | gen命令去重→task-pipeline共享 | CLI | +6 | f3caed7 |
| C6 | runCompileCheck +Rust/C#/Java | 验证管线 | +7 | f3caed7 |
| C7 | read_file doc-reader跳过源码 | 工具执行器 | — | f3caed7 |
| C8 | TS Program LRU缓存 | TS数据流 | +5 | f3caed7 |
| — | DDG HTML双后端+磁盘缓存 | Web搜索 | +8 | 0c6f8c4 |
| — | 危险命令补全(19种)+dry-run | 工具执行器 | +6 | 0c6f8c4 |
| — | 4策略JSON解析 | 代码生成 | +4 | 0c6f8c4 |
| — | Go/Python/Java脚手架 | 代码生成 | +4 | 0c6f8c4 |
| — | Math.random→crypto.randomUUID | 全模块 | — | afacdbd |
| T1 | searchWeb rootPath集成 | Web搜索 | +4 | f4b3d3e |
| T2 | code_intel dataFlow+callGraph | 工具执行器 | +4 | f4b3d3e |
| T3 | git glob **/{a,b}/* | 安全门禁 | +4 | f4b3d3e |
| T4 | code new --verify回路 | 代码生成 | +4 | f4b3d3e |
| T5 | 上下文缓存复用 | 上下文装配 | +7 | 架构师 b21f63d |
| T6 | TS数据流 type checker符号解析 | TS数据流 | +12 | ebe2f96 |
| T7 | manifest YAML frontmatter | 记忆系统 | +3 | a9da4d3 |
| T10 | AI驱动测试生成+验证回路 | 自动测试 | +14 | fcffd72 |
| T4b | code review结构化评分 | 代码生成 | +6 | 91bf6f9 |
| T11 | C/C++/Rust解析+Go/Python数据流 | AST解析 | +6 | 91bf6f9 |

---

## 剩余未达 90 分模块（6 个）

| 模块 | 评分 | 差距 | 卡点 | 谁 |
|------|------|------|------|-----|
| 验证管线 | 75 | -15 | 阶段并行化+覆盖率告警 | 架构师 |
| Web 搜索 | 82 | -8 | 缓存预热后台线程 | 可局部修 |
| 工具执行器 | 82 | -8 | read_pdf增强+search_code索引化 | 可局部修 |
| 上下文装配 | 83 | -7 | token预算动态分配 | 架构师 |
| TS 数据流 | 84 | -6 | .js/.jsx文件参与分析 | 可局部修 |
| REPL | 86 | -4 | repl-chat.ts提取 | 架构师 |
| 安全门禁 | 86 | -4 | commit-security 策略配置 | 架构师 |
| 代码生成 | 86 | -4 | code new --with-tests 完善 | 可局部修 |
| 记忆系统 | 86 | -4 | 跨Agent互操作扩展 | 可局部修 |
| 自动测试 | 84 | -6 | Go/Python/Java AI测试生成 | 可局部修 |

---

## 架构师已完成（并行工作）

| 项目 | 状态 |
|------|------|
| commands/命令行模块提取 | ✅ b21f63d |
| OpenAICompatibleProvider基类 | ✅ b21f63d |
| task-engine 任务存储重构 | ✅ b21f63d |
| commit-security.ts 模块提取 | ✅ a9d1ee8 |
| context 缓存复用 | ✅ b21f63d |
| REPL tool-display.ts 提取 | ✅ 部分完成 |
| 验证管线并行化 | ⬜ 立项中 |

---

## 不再范围（需独立项目）

| 项目 | 原因 |
|------|------|
| 国际化(i18n) | UI文本提取+翻译框架 |
| 全局状态隔离(DI容器) | 影响所有测试初始化 |
| Provider热切换 | 配置监听+运行时重建 |
| taskStore事务回滚 | WAL/checkpoint机制 |
