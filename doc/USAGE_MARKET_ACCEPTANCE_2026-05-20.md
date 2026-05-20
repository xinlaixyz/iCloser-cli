# 用户视角与市场需求验收报告

日期：2026-05-20

## 结论

当前项目的产品定位应明确为 **本地工程执行器 + Codex / Claude Code 替代品 + 长期记忆系统**。它面向 Codex / Claude Code 不可用、受限或需要本地可控的环境，已经具备可演示的核心闭环：离线 mock 初始化、项目扫描、doctor 诊断、provider 管理、Memory Kernel 状态、计划生成、质量门禁和 acceptance 测试都能跑通。

但如果按 2026 年 AI coding agent 市场标准衡量，它距离“成熟替代品”仍有差距。主要差距不在“能不能跑命令”，而在 Claude Code 级真实代码交付可信度：稳定读库、跨文件修改、运行测试、解释 diff、失败后继续修复、PR/Issue 工作流、长任务追踪、权限与沙箱产品化、团队审计、真实 Provider 端到端案例。

## 本轮验收

### 工程门禁

| 项 | 结果 |
|----|------|
| `npm run build` | 通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 2026-05-21 复验通过，0 errors / 158 warnings |
| `npm run test:acceptance` | 3 files / 13 passed，89.64s |
| `npm test` | 2026-05-21 复验通过，116 files / 1715 passed / 2 skipped，94.50s |

### 用户路径

在临时 npm 项目中使用 `dist/index.js` 逐步验收：

| 路径 | 结果 | 体验观察 |
|------|------|----------|
| `ic --help` | 通过，约 0.9s | 命令入口清楚 |
| `ic setup --mock --json` | 通过，约 0.7s | 离线 mock 对新用户友好 |
| `ic init` | 通过，约 4.5s | 非 git 项目输出 `fatal: not a git repository`，需要降噪 |
| `ic scan --json` | 通过，约 4.6s | JSON 输出可被 CI 消费 |
| `ic doctor --json` | 通过，约 0.7s | readiness 结构化输出可用 |
| `ic provider list --json` | 通过，约 0.7s | Provider 管理入口可用 |
| `ic mem status` | 通过，约 0.7s | Memory Kernel 自动激活可见 |
| `ic plan create ...` | 通过，约 0.7s | 计划输出可读 |

## 本轮修复

发现：coverage 阶段没有尊重项目自带 `coverage` / `test:coverage` 脚本，而是直接 fallback 到 `npx c8 vitest run --coverage`。在临时项目和 CI 环境中，这会造成长时间卡住或超时。

修复：`src/core/verifier.ts` 的 coverage stage 改为复用统一的 `resolveStageCommand()`，优先执行项目脚本，尊重调用方 timeout；如果命令通过但输出没有覆盖率文本，会尝试解析标准 coverage 文件。

验证：`tests/verifier-coverage.test.ts` 与 `tests/verifier.test.ts` 定向通过；完整 `npm test` 通过。

## 市场需求对照

### 市场基线

- OpenAI Codex/Codex CLI 强调终端内读代码、改代码、运行代码，并支持端到端完成任务。
- Claude Code 的公开定位是读取代码库、跨文件修改、运行测试并交付提交。
- GitHub Copilot coding agent 强调 GitHub PR 工作流：agent 在 PR 中工作、推送提交、用户可查看过程日志。
- 近期 agentic coding 研究和行业观察都显示：市场重点已经从 autocomplete 转到能提交 PR、跑验证、有审计日志、能被团队流程接住的 autonomous coding agent。

### 当前项目优势

| 维度 | 当前优势 |
|------|----------|
| 本地工程理解 | 扫描、索引、跨语言 AST、项目检测覆盖面较广 |
| 质量门禁 | build/test/lint/coverage/gate/report 基础完整 |
| 中文开发者体验 | 中文提示、doctor、计划、报告比多数英文工具更贴近国内团队 |
| 离线可用 | mock Provider 能完成入门和 CI 回归 |
| 记忆系统 | Memory Kernel 是差异化能力，尤其适合长期项目上下文 |

### 发布前阻塞

| 优先级 | 问题 | 为什么影响市场化 |
|--------|------|------------------|
| P0 | 命令输出仍有 `fatal: not a git repository`、Memory mock error、git ignore 权限 warning | 新用户会误以为初始化失败 |
| P0 | README/PRD 中规模、测试数量仍有部分自动生成历史描述 | 用户和投资/市场材料会不可信 |
| P0 | 缺少真实 Provider 端到端验收记录 | 要成为 Claude Code 替代品，必须证明真实读库、改代码、跑测试、修复失败 |
| P1 | PR/Issue/GitHub 工作流弱 | 与 Copilot coding agent / Codex 云端任务相比缺少团队入口 |
| P1 | 长任务可视追踪和失败恢复还不够产品化 | agent 任务越长，用户越需要过程透明 |
| P1 | 权限、沙箱、审计缺少统一产品叙事 | 企业使用要求可控、可追责、可回滚 |

## 建议路线

1. 发布前先做“信任感修复”：清理非 git fatal、Memory mock error、git ignore warning；所有失败都改成中文、分级、可行动提示。
2. 做一条 Claude Code 替代品黄金路径：在小型 TS 项目中 `setup -> scan -> task -> plan -> diff -> verify -> report -> rollback/commit`，输出可复查验收日志。
3. 做 GitHub/PR 最小闭环：从 issue/任务生成分支、提交、PR 描述、验证摘要。
4. 把 Memory Kernel 定位为“项目长期上下文与团队规则记忆”，不要只说“记忆核心”，要展示它如何减少重复解释和错误修复。
5. 将 CI 分层：quick gate、acceptance gate、market demo gate，避免全量测试作为每次开发的唯一入口。

## 参考来源

- OpenAI Codex: https://openai.com/codex/
- OpenAI Codex CLI Help: https://help.openai.com/en/articles/11096431-Openai-Codex-Letting-Tharted
- GitHub Copilot coding agent docs: https://docs.github.com/en/copilot/using-github-copilot/coding-agent/about-assigning-tasks-to-copilot
- GitHub Copilot coding agent announcement: https://github.com/newsroom/press-releases/coding-agent-for-github-copilot
- Anthropic Claude Code: https://www.anthropic.com/product/claude-code
- Agentic coding PR study: https://arxiv.org/abs/2601.18341
- Failed agentic PR study: https://arxiv.org/abs/2601.15195
