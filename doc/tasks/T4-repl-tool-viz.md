# T4 — REPL 工具执行可视化

日期：2026-05-20  
模块：`src/cli/repl.ts` · `src/core/tool-loop.ts`  
优先级：P0  
状态：**首版已落实，待真实 REPL 观感复验**

## 0. 架构师验收结论（2026-05-20）

验收对象：**T4 REPL 工具执行可视化**  
用户目标：工具调用过程实时展示，解决“工具结果不显示 / 用户感觉卡死”的体验问题。

当前结论：**通过代码级验收，进入人工交互复验阶段**。

已确认落实：

- `src/cli/repl.ts` 已在 `handleChatWithTools()` 的 `runToolLoop({ onProgress })` 中接入实时工具过程展示。
- `thinking` 阶段显示“第 N 轮 思考中...”，不换行，后续工具调用会原地覆写。
- `tool_call` 阶段显示工具图标、工具名、参数 hint，不换行。
- `tool_result` 阶段用 `\r\x1b[K` 覆写同一行，提交为一行完成态，包含成功/警告、结果长度和内容预览。
- `synthesizing` 阶段显示“整合结果...”。
- `done` 阶段显示轮次和工具调用次数。
- `extractToolHint()` / `extractResultPreview()` 已导出并有单元测试覆盖。

本轮验证：

```bash
npx vitest run tests/repl-tool-viz.test.ts tests/tool-loop.test.ts
# 2 files / 29 tests passed
```

待人工复验：

- 在真实 REPL 中用 mock provider 和真实 provider 各跑一次多工具任务，观察终端是否出现残留光标、重复换行、中文宽字符错位。
- 在 Windows、macOS、Linux 三端各跑一次，尤其检查 macOS Terminal / iTerm2 的 `\r\x1b[K` 行覆写效果。
- 在 `--json` 或非 REPL 路径确认不会输出工具进度，避免污染机器可读输出。

---

## 1. 问题描述

用户在 REPL 中输入任务后，AI 会调用多轮工具（read_file / search_code / web_fetch 等）。  
当前体验：

```
  ◉ AI 分析中...
  📖 read_file src/utils/fs.ts
    ✓ 1234 字符
  🔧 web_fetch https://example.com
    ✓ 892 字符
  ● 2 轮完成
```

**三个核心缺陷：**

| # | 症状 | 根因 |
|---|------|------|
| C1 | 轮次之间完全无输出，感觉卡死 | `thinking` / `synthesizing` phase 未处理 |
| C2 | 每个工具占两行（call + result 各一行） | `tool_call` 先写 `\n`，导致 `tool_result` 无法原地覆写 |
| C3 | `✓ 1234 字符` 不传递有效信息 | `tool_result` 只显示字节数，无内容预览 |
| C4 | 10+ 种工具都显示 `🔧` | icon 表只映射 3 种工具 |

---

## 2. 目标体验

每个工具调用最终显示为**一行**，分三个阶段渐进：

```
阶段 1（tool_call 触发，无 \n）：
  📖 read_file  src/utils/fs.ts

阶段 2（tool_result 触发，\r\x1b[K 覆写同一行）：
  📖 read_file  src/utils/fs.ts  ✓ 1.2K  · export function writeFile, readFile...

思考阶段（thinking，无 \n，可被后续 tool_call 覆写）：
  ◉ 第 2 轮  思考中...

结束行（done，覆写思考行）：
  ● 3 轮 · 7 次工具调用
```

完整示例（8 行取代原来的 14 行）：

```
  ◉ AI  分析中...
  📖 read_file  src/utils/fs.ts  ✓ 1.2K  · export function writeFile, readFile...
  🔍 search_code  /createTask/  ✓ 12条  · task-engine.ts:42 export function create...
  🌐 web_fetch  https://example.com  ✓ 892  · Example Domain - This domain is for use...
  📝 read_docx  docs/spec.docx  ✓ 3.4K  · 第一章 接口规范 本文档描述...
  ⚡ run_command  $ npm test  ✓ 87行  · > icloser@1.0.0 test...
  ● 2 轮 · 5 次工具调用
```

---

## 3. 技术方案

### 3.1 核心：`\r` 无 `\n` 的单行动画

```
tool_call  → stdout.write(`\r\x1b[K  ${icon} ${name}  ${hint}`)         // 无 \n
tool_result → stdout.write(`\r\x1b[K  ${icon} ${name}  ${hint}  ${status}  ${preview}\n`)  // 有 \n
```

- `\r` 回到行首，`\x1b[K` 清除到行尾，然后写完整信息
- `tool_call` 不写 `\n`，光标停在该行；`tool_result` 覆写后提交 `\n`
- `thinking` 同样不写 `\n`，被下一个 `tool_call` 的 `\r` 自然覆写

### 3.2 状态跟踪（onProgress 闭包内）

```typescript
let lastCallInfo: { toolName: string; hint: string; icon: string } | null = null;
let vizToolCount = 0;
```

- `tool_call` 时保存 `lastCallInfo`，用于 `tool_result` 重建完整行
- `vizToolCount` 累计工具调用次数，显示在 `done` 行

### 3.3 工具图标表（TOOL_ICONS）

| 工具 | 图标 |
|------|------|
| read_file | 📖 |
| read_docx | 📝 |
| read_xlsx | 📊 |
| read_pdf | 📄 |
| search_code | 🔍 |
| run_command | ⚡ |
| web_search | 🌐 |
| web_fetch | 🌐 |
| code_intel | 🔬 |
| git_status | 🌿 |
| list_dir | 📁 |
| get_project_overview | 🗺 |
| *(default)* | 🔧 |

当前已知工具为 12 个：`read_file`、`read_docx`、`read_xlsx`、`read_pdf`、`search_code`、`run_command`、`web_search`、`web_fetch`、`code_intel`、`git_status`、`list_dir`、`get_project_overview`。这些工具均已有专用图标，`🔧` 只用于未来未知工具。

### 3.4 内容预览提取（extractResultPreview）

| 工具 | 预览逻辑 |
|------|----------|
| search_code | `N条 · 第一条匹配路径:行号` |
| web_search | 第一条结果标题 |
| web_fetch | `标题: ...` 行内容 |
| read_file / read_docx / read_xlsx / read_pdf | 首行有效内容（跳过元数据行）|
| run_command | 第一行输出 |
| code_intel | `导出 (N): ...` 行 |
| git_status | 第一行状态 |
| list_dir | `N 项` |
| *(default)* | 第一行非空内容，截 60 字符 |

### 3.5 hint 格式（extractToolHint）

| 工具 | hint 格式 |
|------|----------|
| search_code | `/pattern/` |
| web_search | `"query"` |
| run_command | `$ command` |
| *(default)* | `path` 或 `url`，截 50 字符 |

---

## 4. 实施步骤

| # | 文件 | 改动内容 |
|---|------|----------|
| S1 | `src/cli/repl.ts` | ✅ 新增模块级常量 `TOOL_ICONS` |
| S2 | `src/cli/repl.ts` | ✅ 新增 `extractToolHint(toolName, args)` 函数 |
| S3 | `src/cli/repl.ts` | ✅ 新增 `extractResultPreview(toolName, result)` 函数 |
| S4 | `src/cli/repl.ts` | ✅ 替换 `handleChatWithTools` 内的 `onProgress` 回调 |
| S5 | `tests/repl-tool-viz.test.ts` | ✅ 新增纯函数单测（hint 提取、preview 提取）|
| S6 | 真实 REPL | 待复验：mock/真实 provider 多工具任务观感 |
| S7 | 跨平台 | 待复验：Windows/macOS/Linux 终端覆写效果 |

## 4.1 后续拆解任务

| 子任务 | 优先级 | 负责人 | 交付物 | 验收标准 |
|--------|--------|--------|--------|----------|
| T4-A | P0 | 程序员2 | 真实 REPL 录屏或日志 | 多工具任务中每个工具最终一行展示 |
| T4-B | P0 | 程序员2 | macOS 复验记录 | macOS Terminal / iTerm2 无错位、无残留进度行 |
| T4-C | P1 | 程序员2 | `smoke:repl` 或新增交互 smoke | 能捕获工具进度关键词和最终完成行 |
| T4-D | P1 | 架构师 | 产品文档更新 | README/TESTING/API 中说明 REPL 工具过程可视化 |
| T4-E | P2 | 程序员2 | 进度显示抽模块 | 将 REPL 内联渲染逻辑迁入 `src/cli/tool-display.ts`，降低 `repl.ts` 负担 |

---

## 5. 不在本任务范围内

- 修改 `ToolLoopProgress` 接口（已有所有必要字段）
- 修改 `runToolLoop` 内部逻辑
- 引入 spinner 库（用 `\r` 原地刷新即可，无需依赖）
- REPL 以外的调用路径（execution-engine.ts 中的 executeToolCall 走全局 hook，不受影响）

---

## 6. 验收标准

- [x] 每个工具调用最多占一行（tool_call + tool_result 合并）
- [x] `thinking` 阶段显示 `◉ 第 N 轮  思考中...`，被下一行覆写
- [x] `synthesizing` 阶段显示 `◉ 整合结果...`
- [x] 12 种已知工具各有对应图标，无 `🔧` fallback 于已知工具
- [x] `tool_result` 预览不为空（有效结果时）
- [x] 测试：`extractToolHint` / `extractResultPreview` 纯函数各有 ≥ 3 个用例
- [ ] 人工 REPL 观感验收：真实终端中无错位、无多余空行、无残留 spinner
- [ ] macOS 观感验收：符合 `doc/MACOS_ACCEPTANCE_STANDARD_2026-05-20.md`

## 7. 验收风险

- 当前测试主要覆盖纯函数和 `runToolLoop` 事件触发，不能完全模拟真实终端的光标覆写效果。
- `src/cli/repl.ts` 仍偏大，T4 首版为了快速落地采用内联闭包；后续应抽到 `src/cli/tool-display.ts`，便于独立测试。
- 中文宽字符、emoji 图标在不同终端中宽度可能不同，macOS 复验必须保留。
