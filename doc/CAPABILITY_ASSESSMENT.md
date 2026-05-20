# AgentCode 关键能力综合评分

日期：2026-05-21  
评估口径：以 `docs/PRD.md`、当前代码、全量验收结果和“本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统”的市场目标为准。  
当前基线：`npm test` 116 files / 1715 passed / 2 skipped，`tsc --noEmit` 通过，`npm run lint` 0 errors / 158 warnings。

## 一、总评分

综合评分：**8.1 / 10**

| 能力维度 | 分数 | 权重 | 加权 | 结论 |
|----------|------|------|------|------|
| AI 记忆能力 | 8.4 | 15% | 1.26 | 有明显差异化，已接近专业级项目记忆 |
| 工具能力 | 8.4 | 15% | 1.26 | 工具面广，web_search 项目缓存与 PDF 噪音补漏后更接近可演示 |
| 代码能力 | 8.2 | 20% | 1.64 | 已能闭环生成/修复/验证，并补齐 AI 测试与结构化 code review；真实 Provider 黄金路径仍不足 |
| 测试能力 | 8.7 | 15% | 1.31 | 本地质量门禁扎实，全量 1715 tests 通过 |
| 架构能力 | 7.2 | 15% | 1.08 | 核心分层清晰，但 `index.ts` 主流程仍偏重 |
| 产品可用性 | 7.0 | 10% | 0.70 | CLI 可演示，工具输出噪音已有补漏；发布级信任感还差长任务体验 |
| 安全与可控性 | 7.8 | 5% | 0.39 | 有路径、命令、回滚、门禁基础，沙箱产品化还需加强 |
| 文档与市场表达 | 8.0 | 5% | 0.40 | 文档已补齐主线和本次架构师验收，但需保持自动同步 |

**架构师判断**：AgentCode 的目标应明确为“本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统”，尤其服务这些工具无法使用、受限或企业要求本地可控的场景。当前已经不是“玩具 CLI”，而是一个具备工程闭环和长期项目记忆的本地 AI coding agent 原型；下一阶段必须把 Claude Code 级代码能力和 Memory Kernel 长期记忆作为双主线，而不是只补本地命令能力。

## 二、AI 记忆能力：8.4 / 10

### 已具备

- Memory Kernel 已覆盖 Sensory / Working / Episodic / Semantic Memory。
- Recall 支持 timeline、semantic、emotion 三类召回，并通过 Context Composer 进入 LLM 上下文。
- 支持 `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、`.cursor/rules` 导入语义记忆，并可导出到 `AGENTS.md`。
- Node 18/20 可降级到 JSONL + rules 文件，Node 24+ 可使用 SQLite 索引，不再因运行时版本破坏 PRD 承诺。
- 记忆注入前已有真实性校验、路径存在性检查和幻觉标记过滤。
- 中文任务到英文代码的关键词/别名匹配已覆盖上下文与记忆匹配路径。

### 对标判断

Claude Code 的市场预期包括 `CLAUDE.md`、`/memory`、项目/用户/本地多层记忆，以及自动记忆管理。AgentCode 目前在“结构化记忆系统”上更重，优势是可审计和可召回；弱项是用户直接编辑、审批和可视化体验还不够顺。

Codex CLI 的项目说明习惯更偏 `AGENTS.md` 与仓库级指令。AgentCode 已补上导入/导出，但还缺少像“启动时明确显示加载了哪些项目指令、哪些记忆被采用”的透明体验。

### 扣分点

- 测试日志仍出现 Memory mock 初始化 ERROR，对普通用户会造成“记忆系统不稳定”的错觉。
- `ic mem edit` 尚未实现，用户不能像 Claude Code `/memory` 那样自然维护记忆。
- 记忆候选审批、AGENTS.md 导出、任务完成总结三者还没有形成一键闭环。

## 三、工具能力：8.2 / 10

### 已具备

当前 AI 可用工具包括：

| 工具 | 能力 |
|------|------|
| `read_file` | 读取项目文件，含长文件压缩 |
| `search_code` | 代码正则搜索 |
| `run_command` | 构建、测试、lint、启动等本地命令 |
| `web_search` | 网络搜索，支持不可用降级 |
| `code_intel` | 符号、导出、类型/代码智能查询 |
| `git_status` | status/log/diff/branch |
| `web_fetch` | 抓取网页正文 |
| `list_dir` | 目录探索 |
| `get_project_overview` | 一次获取项目画像 |
| `read_pdf` | PDF 文本提取 |

工具系统已经有危险命令拦截、Windows 命令适配、空结果重试提示、工具健康检查、tool loop 和工具使用统计。

### 对标判断

Codex / Claude Code 的强点是工具调用与终端交互的“过程感”：用户能看到 agent 在读什么、跑什么、为什么等待。AgentCode 的工具底层能力已经接近，但产品层展示还偏工程日志，不够像一个成熟 coding agent。

### 扣分点

- 权限/沙箱是能力级存在，尚未形成产品级审批模型。
- 工具执行过程在 REPL/CLI 中的可视化不足。
- `web_search` 与 `web_fetch` 受网络环境影响较大，离线降级可用但市场演示时要说明；`web_search` 项目级磁盘缓存已接入工具主链路。

## 四、代码能力：8.2 / 10

### 已具备

- AI 输出统一经过 `parseAIOutput()` 协议解析，降低自由文本写坏文件的风险。
- `generateWithVerifyLoop()` 支持生成后验证与修复循环。
- 写文件路径限制在项目根目录内，防止 `..` 或绝对路径越权。
- 支持 `ic gen`、`ic code`、`ic t --go`、`code scaffold/new/fix/complete/refactor` 等入口。
- `ic t` 主链路已接入 `generatePlanAsync()`，任务规划会优先使用 AI 语义拆解，失败降级关键词方案。
- 空测试检测已覆盖 `it/test("x", () => {})`、`async () => {}` 等常见假测试。
- 回滚、快照、质量门禁、影响面展示已经具备基础闭环。
- AI 驱动测试生成和验证修复回路已有定向测试覆盖。
- 结构化 code review 已具备多维评分和问题清单输出。
- C/C++/Rust 解析、Go/Python 数据流、TS type checker 路径进入代码智能能力面。

### 对标判断

作为 Claude Code 替代品候选，AgentCode 必须稳定完成“读项目 -> 理解约定 -> 制定计划 -> 跨文件改代码 -> 展示 diff -> 运行测试 -> 失败修复 -> 报告/回滚/提交”的闭环。当前基础已经具备，但与 Claude Code 成熟体验相比，仍缺少高质量真实案例：例如一个公开小项目上完成需求、展示 diff、跑测试、生成提交说明、可回滚。

### 扣分点

- 真实 Provider 端到端验收不足，mock 通过不等于市场可售。
- `index.ts` 任务执行主链路仍偏集中，后续扩展代码能力时维护成本高。
- PR/Issue/commit 工作流不完整，离可替代 Claude Code / Codex 的团队协作型 coding agent 还有距离。

## 五、测试能力：8.5 / 10

### 已具备

- 全量测试：116 个测试文件，1715 passed / 2 skipped。
- 构建、类型、lint 均通过。
- Acceptance 覆盖 pipeline / codegen / rollback。
- JSON contract spawn 测试保证 CLI JSON 输出可被自动化系统消费。
- Memory、tool、verifier、code-writer、context、provider、task-engine 均有较厚覆盖。
- 文档已同步最新测试基线，避免“代码绿、文档旧”的信任问题。

### 扣分点

- 全量测试仍有 lint warnings：当前 158 个，需要发布前分批清理。
- 全量测试约 70 秒，CI 应分层为 quick / acceptance / market-demo。
- 真实 Provider 和真实仓库任务验收仍不足。

## 六、架构能力：7.2 / 10

### 已具备

- Provider 已抽出 `OpenAICompatibleProvider` 基类，DeepSeek/OpenAI/Qwen 复用度提升。
- task / memory 命令已迁到 `src/commands/`。
- `task-engine`、`context`、`memory`、`tool-executor`、`verifier`、`code-writer` 分层基本清楚。
- 任务存储已改成磁盘为权威源，内存为懒加载缓存层。
- `createCommit`、`writeFile`、`ic stop`、fail/fatal 等安全与流程问题已有架构级修复；其中 `createCommit` 安全策略已独立为 `src/core/commit-security.ts`，提交前统一做消息、路径、realpath 与敏感文件校验。

### 扣分点

- `src/index.ts` 仍承担大量命令和任务执行主流程，P3#22 只能算阶段性完成。
- `src/cli/repl.ts` 仍偏大，REPL、工具展示、记忆注入等职责需要再切。
- 部分能力文档评分曾高于真实端到端能力，需要持续用验收结果压住自评膨胀。

## 七、产品与市场可用性：6.8 / 10

### 优势

- 中文开发者体验明显优于多数英文 agent CLI。
- 离线 mock Provider 对安装、演示、CI 友好。
- Memory Kernel 是差异化卖点，可包装成“项目长期上下文与团队规则记忆”。
- 本地 CLI 形态适合安全敏感团队先试用。

### 发布前阻塞

| 优先级 | 问题 | 影响 |
|--------|------|------|
| P0 | 非 git 项目输出 `fatal: not a git repository` | 新用户会误判初始化失败 |
| P0 | lint warning 数量仍高 | 削弱发布级信任感 |
| P0 | 缺少真实 Provider 黄金路径 | 难以证明真实代码交付能力 |
| P1 | 无 PR/Issue 最小闭环 | 弱于 Copilot coding agent 类团队入口 |
| P1 | 长任务状态与失败恢复不够产品化 | agent 任务越长，用户越需要透明 |

## 八、下一步行动

### 1. 发布前信任感修复

- 清理非 git fatal、git ignore warning、Memory mock ERROR。
- 所有预期内降级都改成中文、分级、可行动提示。
- 把测试输出保持为“0 失败 + 低噪音”，这是市场第一印象。

### 2. Claude Code 替代品黄金路径

建立一个固定 demo 项目，跑通：

```text
setup -> scan -> task -> plan -> code change -> diff -> verify -> repair -> report -> rollback/commit
```

验收产物必须包含：输入任务、AI 计划、修改文件、diff、测试结果、失败修复记录、回滚或提交记录、最终报告。

### 3. GitHub / PR 最小闭环

- `ic pr create`：生成分支、提交、PR 描述和验证摘要。
- `ic issue plan`：从 issue 文本生成任务计划。
- 先做本地 git 输出，再接 GitHub API。

### 4. Memory 产品化

- 增加 `ic mem edit`。
- `ic t` 开始前展示“本次采用了哪些项目记忆”。
- 任务完成后自动生成候选规则，用户批准后刷新 `AGENTS.md`。

### 5. 架构继续拆分

- `src/index.ts` 下一步拆出 `commands/code.ts`、`commands/docs.ts`、`commands/provider.ts`。
- `executeTask()` 拆成 pipeline：context、plan、generate、write、verify、report。
- `src/cli/repl.ts` 拆出 tool display、memory display、chat handler。

## 九、对标总结

| 能力 | Codex / Claude Code 市场预期 | AgentCode 当前状态 | 评分 |
|------|-------------------------------|--------------------|------|
| 项目记忆 | 项目说明文件 + 会话记忆 + 自动记忆 | Memory Kernel 更重，文件导入/导出已补 | 8.4 |
| 工具执行 | 读写文件、跑命令、沙箱/审批、过程透明 | 工具多，审批和展示还需产品化 | 8.2 |
| 代码交付 | 改代码、跑测试、解释 diff、可回滚 | 本地闭环已成，真实 Provider 案例不足 | 7.6 |
| 团队协作 | PR/Issue/审计/长任务 | 审计基础有，PR/Issue 弱 | 6.5 |
| 企业信任 | 权限、沙箱、可追责、低噪音 | 安全基础有，输出噪音仍扣分 | 7.2 |

一句话：**AgentCode 的核心形态是“本地工程执行器 + Claude Code 替代品 + 长期记忆”，最强抓手是“本地工程上下文 + Memory Kernel + 质量门禁”，最该补的是“真实代码交付案例 + 发布级低噪音 + 团队协作闭环”。**

## 参考来源

- OpenAI Codex CLI Getting Started: https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started
- Claude Code overview: https://docs.claude.com/en/docs/claude-code/overview
- Claude Code memory: https://docs.claude.com/en/docs/claude-code/memory
- Claude Code project memory: https://code.claude.com/docs/en/memory
