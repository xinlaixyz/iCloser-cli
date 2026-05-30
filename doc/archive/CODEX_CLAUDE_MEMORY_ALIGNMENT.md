# Codex / Claude Code 对标与记忆功能方案

日期：2026-05-20

## 对标结论

AgentCode 的产品目标不是只对标 Codex / Claude Code，而是形成 **本地工程执行器 + Claude Code / Codex 替代品 + 长期记忆系统**。在 Codex / Claude Code 不可用、受限或企业需要本地可控时，AgentCode 要承担读库、改代码、跑验证、审计、回滚和长期记忆。当前已经具备本地 CLI、项目扫描、任务执行、质量门禁、Provider 管理和 Memory Kernel；要成为替代品，差距主要在两层：

1. 显式项目记忆文件：Codex 生态常用 `AGENTS.md`，Claude Code 使用 `CLAUDE.md` 和 `/memory` 管理项目/用户记忆。用户需要能直接编辑这些文件，并让 agent 自动读取。
2. Claude Code 级代码闭环：Codex / Claude Code 更强调从任务到读库、跨文件修改、测试、失败修复、提交/PR 的完整闭环；AgentCode 已有本地闭环，但真实 Provider 黄金路径、GitHub PR、Issue、长任务追踪和团队审计还需要加强。

## 已新增能力

### Agent 记忆文件导入

新增 `ic mem import [file...]`：

- 默认扫描 `AGENTS.md`
- 默认扫描 `CLAUDE.md`
- 默认扫描 `.github/copilot-instructions.md`
- 默认扫描 `.cursor/rules`

导入逻辑会从 Markdown 标题、列表、规则语句中提取可执行项目规则，写入 Memory Kernel 的 Semantic Memory。代码块会被跳过，避免把示例命令误当作规则。

### Agent 记忆文件导出

新增 `ic mem export [file]`：

- 默认导出到 `AGENTS.md`
- 将当前项目语义规则写成 Codex/Claude/Copilot 都容易读取的 Markdown 指令
- 阻止导出到项目根目录之外，避免越权写文件

### Agent 记忆文件发现

新增 `ic mem manifests`：

- 列出当前项目中可识别的 Agent 记忆文件
- 让用户知道哪些文件会被导入为项目记忆

### 可靠性补强

- 全局配置与旧全局 Memory 均遵守 `ICLOSER_HOME`，避免测试、便携运行或沙箱环境误写真实用户目录。
- 全局 Memory 在权限受限时降级为 best-effort，不再阻塞正常任务执行。
- AI 生成代码写盘前限制在项目根目录内，防止模型输出绝对路径或 `..` 路径造成越权写入。
- 空测试检测扩展到 `it/test("x", () => {})` 和 `async () => {}`，避免“看似有测试、实际没断言”的交付。

## 使用方式

```bash
ic mem manifests
ic mem import
ic mem import AGENTS.md CLAUDE.md
ic mem recall "测试前需要做什么"
ic mem export AGENTS.md
```

## 与 Codex / Claude Code 的关系

| 能力 | Codex / Claude Code 市场预期 | AgentCode 当前状态 |
|------|-------------------------------|--------------------|
| 终端内读写代码 | 读取项目、跨文件修改、运行命令、失败后继续修复 | 已具备基础，需真实 Provider 黄金路径证明 |
| 项目级记忆 | `AGENTS.md` / `CLAUDE.md` 明确记录约定 | 已支持导入/导出 |
| 会话中记忆检索 | `/memory` / 上下文自动注入 | 已有 `ic mem recall` 和 Memory Kernel recall |
| 跨会话持续学习 | 用户偏好、项目规则、历史任务沉淀 | 已有 Sensory/Working/Episodic/Semantic Memory |
| 权限与可控执行 | 文件写入、命令执行可审计 | 已有基础，仍需更强产品化 |
| PR / Issue 工作流 | 从 Issue 到 PR、测试和提交 | 待加强 |
| 多入口体验 | Terminal、IDE、Web/GitHub 等 | 当前以 CLI 为主 |

## 后续 P0/P1

### P0

- `ic init` 非 git 项目不应输出原始 `fatal: not a git repository`，应改成安静跳过或中文提示。
- Memory mock 初始化失败已不以 ERROR 形式污染普通测试/用户输出；后续只允许 debug 或明确中文降级提示。
- README/PRD 中自动生成的规模数字需要继续保持和 `npm test` 基线同步。

### P1

- 增加 `ic mem edit`：打开或生成 `AGENTS.md`，让用户像 Claude Code `/memory` 一样编辑记忆。
- 增加 `ic pr create` 或 `ic github issue` 最小闭环：计划、变更、测试、PR 描述。
- 将 Memory Kernel 的“候选记忆审批”与 `AGENTS.md` 导出结合：用户批准后自动刷新项目说明。
- 增加 IDE/编辑器侧入口，至少提供 VS Code command 或文档。

## 本轮验收

```bash
npm run build
npx tsc --noEmit
npm run lint
npm test
```

结果：

- `npm run build` 通过。
- `npx tsc --noEmit` 通过。
- `npm run lint` 通过：custom lint 237 files，ESLint 0 errors / 9 warnings（2026-05-21 复验）。
- `npm test` 通过：116 test files，1715 passed / 2 skipped，94.50s（2026-05-21 复验）。
- 真实 CLI 验收通过：`ic mem manifests`、`ic mem import`、`ic mem recall`、`ic mem export AGENTS.generated.md` 在含 `AGENTS.md` / `CLAUDE.md` 的临时项目中可完成。

## 参考

- OpenAI Codex: https://openai.com/codex/
- OpenAI Codex CLI Help: https://help.openai.com/en/articles/11096431-Openai-Codex-Letting-Tharted
- Claude Code overview: https://docs.claude.com/en/docs/claude-code/overview
- Claude Code memory: https://docs.claude.com/en/docs/claude-code/memory
- Claude Code slash commands: https://docs.anthropic.com/en/docs/claude-code/slash-commands
