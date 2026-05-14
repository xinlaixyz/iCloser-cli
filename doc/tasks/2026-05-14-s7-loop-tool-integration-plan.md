# S7 三步循环 × 五大工具接入计划

日期：2026-05-14
阶段：S7
目标：把 S6 的机制协议接入真实运行路径，让 iCloser 在 REPL 和任务主链里按“收集上下文 → 采取行动 → 验证结果”循环工作，并明确使用五大工具能力。

## 总体目标

S7 不再新增概念，重点是把机制落到用户能感知的执行体验：

```text
用户输入 Prompt
  ↓
收集上下文：文件操作 / 搜索 / 网络搜索 / 代码智能
  ↓
执行操作：文件操作 / 搜索 / 执行命令
  ↓
验证结果：文件操作 / 搜索 / 执行命令 / 代码智能
  ├─ pass → 任务结束 + 中文报告
  ├─ fail/warn → 带错误回到收集上下文
  └─ 需要人类判断 → 底部中文选择面板
```

## S7.1 Tool Capability Registry（dev2）

### 目标

建立工具能力注册表，让系统知道五大工具当前是否可用、属于内置/外部/插件能力、缺失时如何降级。

### 范围

- 新增 `src/core/tool-registry.ts`
- 新增 `tests/tool-registry.test.ts`
- 读取 `task-loop.ts` 的五大工具定义，生成运行时能力快照
- 支持：
  - `file-ops`：builtin，默认可用
  - `search`：builtin，默认可用
  - `command`：builtin，默认可用但受权限确认
  - `web-search`：external，默认可能不可用，需标注降级
  - `code-intelligence`：plugin-required，默认降级到搜索/编译错误分析

### 验收标准

```bash
npm run test -- tool-registry task-loop
npm run build
```

必须满足：
- 五大工具都有状态、来源、降级策略。
- 任一工具不可用时，能生成中文降级说明。
- 工具状态可以按 loop step 查询，例如收集上下文需要哪些工具。

## S7.2 REPL Loop Status Panel（dev1）

### 目标

REPL 在用户输入后，不再直接“思考中”乱跑，而是显示当前处于哪一步：收集上下文、执行操作、验证结果。

### 范围

- `src/cli/repl.ts`
- `src/cli/theme.ts` 或 `src/cli/tui.ts`
- 允许新增 `src/cli/loop-panel.ts`
- 更新/新增 REPL smoke

### 用户体验要求

底部区域显示：

```text
当前步骤：收集上下文
正在使用：文件操作 / 搜索 / 代码智能(降级)
下一步：执行操作
```

写文件或系统命令时仍使用中文确认面板，用户只选数字。

### 验收标准

```bash
npm run test -- repl-completer choice-panel
npm run smoke:repl
```

必须满足：
- “分析整个项目”先显示收集上下文，不触发普通 AI 聊天。
- “启动项目”显示执行操作，并进入系统权限确认。
- Ctrl+C 或用户输入“换个方法”能进入用户干预路径。

## S7.3 Task Main Chain Loop Hook（dev2）

### 目标

把三步循环接入 `ic t "任务"` 主链，而不只是在 `ic auto chain` 展示。

### 范围

- `src/index.ts`
- `src/core/task-engine.ts` 或新增 `src/core/task-runner.ts`
- `src/core/task-loop.ts`
- `tests/task-engine.test.ts` / 新增 `tests/task-runner-loop.test.ts`

### 验收标准

```bash
npm run test -- task-engine task-loop
npm run smoke
```

必须满足：
- 创建任务后记录 loop state。
- AI 调用前必须完成收集上下文。
- 写入后必须进入验证结果。
- 验证失败时记录下一轮 `collect-context`，不直接把失败扔给用户。

## S7.4 Tool Fallback Messages（dev1）

### 目标

当网络搜索不可用、代码智能插件未安装、命令无法执行时，系统必须给新手能看懂的降级提示。

### 范围

- `src/core/tool-registry.ts` 可读，不冲突修改需协调
- `src/cli/output.ts`
- `src/cli/repl.ts`
- 文案测试或 smoke

### 验收标准

必须出现中文提示：

```text
代码智能暂不可用，已降级为：搜索 + 编译错误分析
网络搜索暂不可用，已使用本地文档和项目记忆
命令执行未完成，系统不会假装验证通过
```

## S7.5 End-to-End Loop Smoke（dev2）

### 目标

新增端到端 smoke，覆盖用户从自然语言输入到三步循环完成的完整路径。

### 范围

- 新增 `scripts/loop-tool-smoke.mjs`
- package 新增 `smoke:loop`
- `smoke:all` 纳入 loop gate

### 验收标准

```bash
npm run smoke:loop
npm run smoke:all
```

必须覆盖：
- 分析整个项目：收集上下文 → 验证完成
- 补齐文档：收集上下文 → 写入确认 → 执行操作 → 验证结果
- 启动项目：收集上下文 → 系统权限确认 → 执行命令
- 缺少代码智能时显示降级，不阻断任务

## 分工原则

- dev1 优先做 REPL 用户体验、底部状态、中文面板、降级文案。
- dev2 优先做核心协议、注册表、任务主链接入、smoke gate。
- 两边不同时修改同一个文件；如必须改 `src/cli/repl.ts`，先约定小节范围。

## 当前推荐执行顺序

1. dev2：S7.1 Tool Capability Registry
2. dev1：S7.2 REPL Loop Status Panel
3. dev2：S7.3 Task Main Chain Loop Hook
4. dev1：S7.4 Tool Fallback Messages
5. dev2：S7.5 End-to-End Loop Smoke
