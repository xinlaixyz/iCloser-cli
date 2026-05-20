# 架构验收记录与程序员2工具能力任务书

日期：2026-05-20  
角色口径：架构师验收 + 程序员2执行任务分配  
依据：`docs/PRD.md`、`doc/CAPABILITY_ASSESSMENT.md`、当前代码、全量测试结果。

## 一、验收结论

当前 A/B 修复和集成补漏后，项目主干达到“继续开发可接受”状态。后续开发目标是围绕“本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统”补齐代码与工具能力：

| 项 | 结果 |
|----|------|
| `npm run build` | 通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 2026-05-21 复验通过，0 errors / 158 warnings |
| `npm test` | 2026-05-21 复验通过，116 files / 1715 passed / 2 skipped，94.50s |
| 工具执行器 | 12 个 AI 可调用工具已注册，`smoke:tools` 47/47 通过 |
| 代码输出协议 | `parseAIOutput()` 已进入主要代码生成路径 |
| 任务规划 | `ic t` 已接入 `generatePlanAsync()`，AI 语义拆解优先、关键词降级 |
| macOS 顺畅度 | 已加入正式检查标准，待真实 macOS 机器或 CI 复验 |
| Commit 安全 | `createCommit` 安全策略已独立为 `src/core/commit-security.ts` |
| T8 REPL 拆分 | 已开始，`tool-display.ts` 已从 `repl.ts` 迁出 |
| T9 验证并行化 | 已立项，待实现 `compile/lint` 安全并行 |

**架构师判断**：可以继续安排程序员2补工具能力。工具补齐必须服务 Claude Code 级代码能力：读更多资料、理解更大代码库、展示工具过程、受限环境可降级、失败后可继续修复。当前不建议继续堆散功能，而应围绕“工具可用、可验收、可展示、可降级”补齐替代品短板。

## 二、当前已验证能力

### AI 记忆能力

- Memory Kernel 可启动、召回、导入/导出 Agent 记忆文件。
- 支持 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`.cursor/rules`。
- Node 18/20 降级路径已明确，Node 24+ 可启用 SQLite 增强。

### 工具能力

当前 `src/core/tool-executor.ts` 已注册：

| 工具 | 状态 | 验收说明 |
|------|------|----------|
| `read_file` | 已有 | 读项目文件，路径安全限制 |
| `search_code` | 已有 | 代码搜索，空结果策略提示 |
| `run_command` | 已有 | 危险命令拦截，Windows 命令适配 |
| `web_search` | 已有 | 网络可用时启用，不可用时降级 |
| `code_intel` | 已有 | 基于项目索引/AST 的代码智能 |
| `git_status` | 已有 | status/log/diff/branch |
| `web_fetch` | 已有 | 抓取网页正文 |
| `list_dir` | 已有 | 目录探索 |
| `get_project_overview` | 已有 | 项目画像 |
| `read_pdf` | 已有 | PDF 文本读取 |
| `read_docx` | 已验收 | Word 需求/规格输入 |
| `read_xlsx` | 已验收 | Excel 表格/测试用例输入 |

### 测试能力

- 工具执行器已有 `tests/tool-executor.test.ts` 与 `tests/tool-executor-extra.test.ts`。
- 工具策略已有 `tests/tool-strategy.test.ts`。
- 工具注册表已有 `tests/tool-registry.test.ts`。
- 仍缺少面向“工具能力矩阵”的集成验收脚本，尤其是 DOCX/XLSX/OCR 和工具过程展示。

## 三、程序员2任务分配

### DEV2-T1：文档工具扩展：DOCX / XLSX（已完成，后续仅维护）

**目标**：让 AI 工具能读取 Word 和 Excel 文件，补齐 Claude Code 替代场景中的需求文档、接口表、测试用例表输入。

| 项 | 要求 |
|----|------|
| 所属文件 | `src/core/tool-executor.ts`，必要时新增 `src/core/doc-reader.ts` 或复用已有文档读取模块 |
| 新工具 | `read_docx`、`read_xlsx` |
| 测试 | 新增或扩展 `tests/tool-executor-extra.test.ts` |
| 验收 | 空参数、路径不存在、路径越界、正常读取、长内容截断都要覆盖 |
| 文档 | 更新 `doc/AI_CAPABILITY_MATRIX.md` 与 `docs/API.md` |

**当前状态**：已进入源码和发布产物验收，`npm run smoke:tools` 已覆盖。后续只做 bug 修复和 macOS 复验。

### DEV2-T2：工具执行过程可视化（首版已落实，进入复验）

**目标**：让用户能看到 AI 正在调用什么工具、为什么调用、结果摘要是什么，达到 Claude Code 类工具的过程透明度。

| 项 | 要求 |
|----|------|
| 所属文件 | `src/core/tool-loop.ts`、`src/cli/repl.ts`、必要时新增 `src/cli/tool-display.ts` |
| CLI/REPL 表现 | 显示工具名、入参摘要、耗时、成功/失败、降级提示 |
| JSON 模式 | 不污染 JSON stdout |
| 测试 | 扩展 `tests/tool-loop.test.ts` 或新增 `tests/tool-display.test.ts` |
| 文档 | 更新 `docs/UI.md`、`doc/CAPABILITY_ASSESSMENT.md` |

**当前状态**：`src/cli/repl.ts` 已接入 `runToolLoop.onProgress`，可显示 thinking/tool_call/tool_result/synthesizing/done。`tests/repl-tool-viz.test.ts` 与 `tests/tool-loop.test.ts` 已通过，代码级验收通过。

**剩余复验**：

| 项 | 要求 |
|----|------|
| 真实 REPL | mock provider 和真实 provider 各跑一次多工具任务 |
| macOS | Terminal / iTerm2 中确认单行覆写无错位 |
| JSON | 确认非 REPL / `--json` 路径不输出进度文本 |
| 抽模块 | 后续将渲染逻辑迁入 `src/cli/tool-display.ts` |

**优先级**：P0  
**建议估时**：复验 0.5 天  
**完成定义**：普通输出可读，JSON 输出仍纯净，macOS 终端观感通过。

### DEV2-T3：工具权限与沙箱说明产品化

**目标**：把现有危险命令拦截、安全规则、路径限制从“代码能力”变成“用户能理解的产品能力”。

| 项 | 要求 |
|----|------|
| 所属文件 | `src/core/tool-executor.ts`、`src/core/security.ts`、`src/commands/*` 或 `src/index.ts` |
| 新命令建议 | `ic tools status` 或并入 `ic doctor --tools` |
| 输出内容 | 工具可用状态、权限级别、危险命令策略、网络工具状态 |
| 测试 | 新增 CLI JSON contract 或命令单测 |
| 文档 | 更新 `docs/API.md`、`doc/USAGE_MARKET_ACCEPTANCE_2026-05-20.md` |

**优先级**：P1  
**建议估时**：0.5 天  
**完成定义**：用户能一眼知道哪些工具可用、哪些受限、为什么受限。

### DEV2-T4：工具能力矩阵验收脚本（已完成，继续扩展 macOS 门禁）

**目标**：建立一条工具能力 smoke，避免后续工具注册、文档和实现漂移。

| 项 | 要求 |
|----|------|
| 新脚本 | `scripts/tool-capability-smoke.mjs` |
| 覆盖工具 | `list_dir`、`read_file`、`search_code`、`run_command`、`git_status`、`get_project_overview`、`read_pdf`，DOCX/XLSX 完成后加入 |
| 输出 | 每个工具 pass/fail/skip + 原因 |
| 测试 | 可作为 npm script，建议 `npm run smoke:tools` |
| 文档 | `docs/TESTING.md` 加入说明 |

**当前状态**：`scripts/tool-capability-smoke.mjs` 与 `npm run smoke:tools` 已存在，当前 47/47 通过。下一步把它加入 `macos-latest` CI 和发布前门禁。

### DEV2-T6：macOS 工具与安装体验复验

**目标**：确保 AgentCode 在 macOS 上作为 Claude Code / Codex 替代品是顺手的，而不只是能编译。

| 项 | 要求 |
|----|------|
| 参考文档 | `doc/MACOS_ACCEPTANCE_STANDARD_2026-05-20.md` |
| CI | 在 `macos-latest` 中增加 `npm run smoke:tools` |
| 真实机器 | 跑通安装、首次运行、mock provider、工具 smoke、记忆导入导出 |
| Shell | 验证 `ls`、`cat`、`grep`、`python3`、`./mvnw`、`./gradlew` |
| 路径 | 覆盖 `/Users/...`、含空格路径、软链接路径 |
| 文档 | 更新 README/TESTING 的 macOS quick start |

**优先级**：P0  
**建议估时**：0.5-1 天  
**完成定义**：macOS 真实验收日志可追溯，失败项全部转成 issue 或修复项。

### DEV2-T5：工具结果压缩与引用来源

**目标**：减少工具返回大文本对上下文的污染，并让 AI 回答可以追溯来源。

| 项 | 要求 |
|----|------|
| 所属文件 | `src/core/tool-executor.ts`、`src/core/tool-loop.ts` |
| 行为 | 每个工具结果都返回 `summary + source + truncated` 元信息 |
| 兼容 | 保持现有字符串返回接口，先用结构化前缀或内部对象适配 |
| 测试 | 覆盖长目录、长文件、长搜索结果 |
| 文档 | 更新 `doc/AI_EXECUTION_ARCHITECTURE.md` |

**优先级**：P2  
**建议估时**：1 天  
**完成定义**：长结果不会直接塞爆上下文，用户能看到来源。

## 四、禁止事项

- 不要改动无关大文件格式化。
- 不要绕过现有路径安全检查。
- 不要让工具在 `--json` 模式输出进度、颜色或非 JSON 文本。
- 不要用 mock 结果冒充真实工具执行。
- 不要新增没有测试和文档的工具。

## 五、程序员2交付清单

每完成一个任务，必须提交：

1. 代码变更说明。
2. 新增/修改测试列表。
3. 运行命令与结果。
4. 文档更新位置。
5. 剩余风险。

最低验收命令：

```bash
npx vitest run tests/tool-executor.test.ts tests/tool-executor-extra.test.ts tests/tool-loop.test.ts tests/tool-registry.test.ts
npx tsc --noEmit
npm run lint
npm run smoke:tools
```

阶段完成后再跑：

```bash
npm test
```

## 六、下一轮架构师复验重点

- 工具数量、文档矩阵、测试覆盖是否一致。
- 新工具是否遵守路径安全和 JSON 输出约束。
- REPL/CLI 工具过程展示是否真正提升用户信任。
- 工具失败是否给出中文、可行动、低噪音提示。
- macOS 是否作为一等公民平台验收，而不是只在 Windows 上通过。
- 是否能支撑 Claude Code 替代品黄金路径演示：读库、改代码、跑测试、失败修复、报告、回滚/提交。
